// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  batchesFor,
  collectRepo,
  countedFetch,
  cursorFor,
  counterRows,
  restGet,
  run,
  speedEvents,
  RATE_FLOOR,
} from '../../scripts/ops-emit.mjs'
import { githubApi } from '../../scripts/speed-metrics.mjs'
import { SOURCES } from '../../server/ops/sources.js'
import { validateBatch } from '../../server/ops/events.js'

// Central metrics M3 (#439, task #449). Offline: every GitHub answer comes from fixtures/ops/api.json.
const API = JSON.parse(readFileSync(new URL('./fixtures/ops/api.json', import.meta.url), 'utf8'))
const NOW = Date.parse('2026-11-26T12:00:00Z')
const REPO = SOURCES[0]
const FULL = 'Shaked/x-thread-draft-tool'

function response(body, remaining) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => (name === 'x-ratelimit-remaining' && remaining !== undefined ? String(remaining) : null) },
    json: async () => structuredClone(body),
  }
}

/**
 * A fake GitHub: answers each REST path from the fixture (`overrides` replaces parts of it). Every URL is recorded.
 * `remaining` is the rate-limit header; `dropAfterCalls` makes it 99 from that call on.
 */
function fakeGitHub({ remaining, dropAfterCalls, totalExtra = 0, totalExtraDay = null, overrides = {} } = {}) {
  const asked = []
  const data = { ...API, ...overrides }
  const fetchImpl = async (url) => {
    asked.push(url)
    const left = dropAfterCalls !== undefined && asked.length >= dropAfterCalls ? 99 : remaining
    const u = new URL(url)
    const path = u.pathname.replace(`/repos/${FULL}`, '')
    const q = u.searchParams
    if (path === '/actions/runs') {
      const sha = q.get('head_sha')
      if (sha) return response({ workflow_runs: data.runs_by_sha[sha] ?? [] }, left)
      // The `created` range "YYYY-MM-DD..YYYY-MM-DD" filters by the run's UTC day, as the API does; pages are 100 long.
      const [from, to] = (q.get('created') ?? '').split('..')
      const matching = data.runs.filter((r) => r.created_at.slice(0, 10) >= from && r.created_at.slice(0, 10) <= to)
      // total_count counts distinct runs, as the API does; a listed-twice run is one run.
      const distinct = new Set(matching.map((r) => r.id)).size
      const page = Number(q.get('page') ?? 1)
      const per = Number(q.get('per_page') ?? 100)
      const slice = matching.slice((page - 1) * per, page * per)
      const extra = totalExtraDay === null || totalExtraDay === from ? totalExtra : 0
      return response({ total_count: distinct + extra, workflow_runs: slice }, left)
    }
    const jobs = path.match(/^\/actions\/runs\/(\d+)\/jobs$/)
    if (jobs) return response({ jobs: data.jobs[jobs[1]] ?? [] }, left)
    if (path === '/pulls') return response(data.pulls, left)
    if (path === '/deployments') return response(data.deployments[q.get('sha')] ?? [], left)
    const statuses = path.match(/^\/deployments\/(\d+)\/statuses$/)
    if (statuses) return response(data.statuses[statuses[1]] ?? [], left)
    const commit = path.match(/^\/commits\/([^/]+)$/)
    if (commit) return response({ files: data.files[commit[1]] ?? [] }, left)
    return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) }
  }
  return { fetchImpl, asked }
}

function clients(fetchImpl) {
  const counted = countedFetch(fetchImpl)
  const api = githubApi({ token: 'test-token', repo: FULL, fetchImpl: counted.fetch })
  const get = restGet({ fetchImpl: counted.fetch, repo: FULL, token: 'test-token' })
  return { api, get, budget: counted.budget }
}

const byKey = (events) => Object.fromEntries(events.map((e) => [`${e.source}/${e.kind}/${e.id}`, e]))

describe('ops-emit: mapping', () => {
  it('maps a stored CI run to a run event keyed by run id and attempt, with the failed job and step', async () => {
    const { fetchImpl } = fakeGitHub()
    const result = await collectRepo(REPO, { ...clients(fetchImpl), now: NOW })
    const events = byKey(result.events)
    expect(events['ci/run/100.1']).toEqual({
      source: 'ci',
      kind: 'run',
      id: '100.1',
      at: '2026-11-25T10:00:30Z',
      name: 'Tests',
      status: 'success',
      ms: 90000,
      attrs: { event: 'pull_request', queue_ms: 30000, pr: 10 },
      link: 'https://github.com/Shaked/x-thread-draft-tool/actions/runs/100',
    })
    expect(events['ci/run/101.1'].attrs).toEqual({
      event: 'pull_request',
      queue_ms: 20000,
      failed_job: 'E2E tests (playwright)',
      failed_step: 'Install Playwright browsers',
    })
  })

  it('maps a merge to a git event and its production deployment to a deploy event', async () => {
    const { fetchImpl } = fakeGitHub()
    const events = byKey((await collectRepo(REPO, { ...clients(fetchImpl), now: NOW })).events)
    expect(events['git/merge/sha-m1']).toMatchObject({ at: '2026-11-25T10:07:30Z', name: 'main', status: 'merged', attrs: { pr: 10 } })
    expect(events['deploy/deploy/501']).toMatchObject({
      at: '2026-11-25T10:08:00Z',
      name: 'Production',
      status: 'success',
      ms: 60000,
      attrs: { sha: 'sha-m1' },
    })
  })

  it('maps the speed stages of a code merge and flags the stages over their limits', async () => {
    const { fetchImpl } = fakeGitHub()
    const events = byKey((await collectRepo(REPO, { ...clients(fetchImpl), now: NOW })).events)
    expect(events['speed/merge/sha-m1:ci']).toMatchObject({ name: 'ci', status: 'ok', ms: 90000, attrs: { pr: 10, limit_ms: 90000 } })
    expect(events['speed/merge/sha-m1:vercel']).toMatchObject({ status: 'over', ms: 90000, attrs: { limit_ms: 35000 } })
    expect(events['speed/merge/sha-m1:smoke']).toMatchObject({ status: 'over', ms: 55000, attrs: { limit_ms: 25000 } })
    expect(events['speed/merge/sha-m1:total']).toMatchObject({ status: 'over', ms: 235000, attrs: { limit_ms: 150000 } })
    // The wait runs from the end of the head commit's CI (09:31:35) to the merge (10:07:30): 2155 s.
    expect(events['speed/merge/sha-m1:merge_wait']).toMatchObject({ status: 'ok', ms: 2155000 })
    expect(events['speed/merge/sha-m1:merge_wait'].attrs).toEqual({ pr: 10 })
  })

  it('a speed stage above the ingest limit is sent as a null duration, not refused', () => {
    const rows = speedEvents(
      { number: 12, kind: 'code', merge_sha: 'sha-long', merged_at: '2026-11-25T10:07:30Z', stages: { ci: null, merge: { running: 0, wait: 3e9 / 1000 }, vercel: null, smoke: null }, total: null },
      'https://github.com/Shaked/x-thread-draft-tool/pull/12',
    )
    const wait = rows.find((r) => r.name === 'merge_wait')
    expect(wait.ms).toBeNull()
    expect(validateBatch({ v: 1, repo_id: REPO.repository_id, events: rows }, { now: NOW }).refused).toEqual([])
  })

  it('a docs-only merge gets ci and total speed rows and no vercel or smoke row', () => {
    const rows = speedEvents(
      { number: 11, kind: 'docs', merge_sha: 'sha-m2', merged_at: '2026-11-24T12:00:00Z', stages: { ci: { running: 60, queue: 5 }, merge: { running: 0, wait: 2935 }, vercel: null, smoke: null }, total: 60 },
      'https://github.com/Shaked/x-thread-draft-tool/pull/11',
    )
    expect(rows.map((r) => r.name)).toEqual(['ci', 'merge_wait', 'total'])
    expect(rows.find((r) => r.name === 'total')).toMatchObject({ status: 'ok', ms: 60000, attrs: { pr: 11, limit_ms: 90000 } })
  })
})

describe('ops-emit: drop rules', () => {
  it('stores no skipped, cancelled, unlisted or still-running run as an event', async () => {
    const { fetchImpl } = fakeGitHub()
    const ids = (await collectRepo(REPO, { ...clients(fetchImpl), now: NOW })).events.filter((e) => e.source === 'ci').map((e) => e.id)
    expect(ids.sort()).toEqual(['100.1', '101.1'])
  })

  it('drops an unmerged pull request', async () => {
    const { fetchImpl } = fakeGitHub()
    const gits = (await collectRepo(REPO, { ...clients(fetchImpl), now: NOW })).events.filter((e) => e.source === 'git')
    expect(gits.map((e) => e.id).sort()).toEqual(['sha-m1', 'sha-m2'])
  })
})

describe('ops-emit: counters, cursor and the overlap', () => {
  it('counts the finished days: a stuck run, a skipped unlisted run and a cancelled run; not today and not stored runs', async () => {
    const { fetchImpl } = fakeGitHub()
    const { counters } = await collectRepo(REPO, { ...clients(fetchImpl), now: NOW })
    expect([...counters].sort((a, b) => a.day.localeCompare(b.day) || a.status.localeCompare(b.status))).toEqual([
      { day: '2026-11-23', source: 'ci', kind: 'run', name: 'Tests', status: 'stuck', count: 1 },
      { day: '2026-11-24', source: 'ci', kind: 'run', name: 'Tests', status: 'cancelled', count: 1 },
      { day: '2026-11-24', source: 'ci', kind: 'run', name: 'other', status: 'skipped', count: 1 },
      // 2026-11-25 has no counted run: its zero row clears the day's earlier counts at ingest.
      { day: '2026-11-25', source: 'ci', kind: 'run', name: 'none', status: 'none', count: 0 },
    ])
  })

  it('moves the cursor to the oldest run still going, but never more than 24 hours behind the newest stored run', async () => {
    const { fetchImpl } = fakeGitHub()
    const { cursor } = await collectRepo(REPO, { ...clients(fetchImpl), now: NOW })
    // Oldest run still going: 2026-11-23T01:00Z (stuck). Newest stored: 2026-11-25T11:00Z, so the floor is 2026-11-24T11:00Z.
    expect(cursor).toBe('2026-11-24T11:00:00.000Z')
  })

  it('the same API answers give the same event ids on a second run, so the ingest inserts nothing twice', async () => {
    const { fetchImpl } = fakeGitHub()
    const first = (await collectRepo(REPO, { ...clients(fetchImpl), now: NOW })).events.map((e) => `${e.source}/${e.kind}/${e.id}`)
    const second = (await collectRepo(REPO, { ...clients(fetchImpl), now: NOW })).events.map((e) => `${e.source}/${e.kind}/${e.id}`)
    expect(second).toEqual(first)
    expect(new Set(first).size).toBe(first.length)
  })

  it('a day with no finished runs in the window gets no counter row', () => {
    expect(counterRows([], REPO, NOW)).toEqual([])
  })

  it('the cursor is the newest stored run when no run is still going', () => {
    const runs = API.runs.filter((r) => r.status === 'completed')
    expect(cursorFor(runs, REPO)).toBe('2026-11-25T11:00:00.000Z')
  })
})

describe('ops-emit: rate limit', () => {
  it('stops cleanly below the floor: no counters and no cursor are sent, and the run is marked incomplete', async () => {
    const { fetchImpl } = fakeGitHub({ remaining: RATE_FLOOR - 1 })
    const result = await collectRepo(REPO, { ...clients(fetchImpl), now: NOW })
    expect(result.complete).toBe(false)
    expect(result.counters).toEqual([])
    expect(result.cursor).toBeNull()
    const [body] = batchesFor(REPO.repository_id, result)
    expect(body).toEqual({ v: 1, repo_id: REPO.repository_id, events: [] })
  })

  it('a complete run sends the counters and the cursor on its last batch only', async () => {
    const { fetchImpl } = fakeGitHub()
    const result = await collectRepo(REPO, { ...clients(fetchImpl), now: NOW })
    const bodies = batchesFor(REPO.repository_id, result)
    expect(bodies).toHaveLength(1)
    expect(bodies[0].counters).toHaveLength(4)
    expect(bodies[0].cursor).toBe('2026-11-24T11:00:00.000Z')
  })
})

describe('ops-emit: dry run', () => {
  it('prints the same bytes twice for the same input, sends nothing, and names no ingest URL', async () => {
    const outputs = []
    const asked = []
    const fetchImpl = async (url, init) => {
      asked.push(url)
      return fakeGitHub().fetchImpl(url, init)
    }
    for (let i = 0; i < 2; i++) {
      await run(['--dry-run', '--repo', FULL], { GITHUB_TOKEN: 'test-token' }, { now: NOW, fetchImpl, log: (line) => outputs.push(line) })
    }
    expect(outputs).toHaveLength(2)
    expect(outputs[0]).toBe(outputs[1])
    expect(JSON.parse(outputs[0])[0].events.length).toBeGreaterThan(0)
    expect(asked.some((url) => url.includes('/api/ops/events') || url.includes('x-thread-draft-tool.vercel.app'))).toBe(false)
  })

  it('needs --repo for a dry run, and refuses an unknown option', async () => {
    await expect(run(['--dry-run'], {}, {})).rejects.toThrow('--repo')
    await expect(run(['--bogus'], {}, {})).rejects.toThrow('unknown option')
  })
})

describe('ops-emit: review fixes on #472', () => {
  it('writes no speed rows for a merge while a run on its head or merge commit is still going', async () => {
    const running = {
      id: 107, run_attempt: 1, name: 'Smoke test (deployed)', event: 'deployment_status', status: 'in_progress', conclusion: null,
      head_sha: 'sha-m1', created_at: '2026-11-25T10:12:00Z', run_started_at: '2026-11-25T10:12:05Z', updated_at: '2026-11-25T10:13:00Z',
      html_url: 'https://github.com/Shaked/x-thread-draft-tool/actions/runs/107', pull_requests: []
    }
    const runsBySha = { ...API.runs_by_sha, 'sha-m1': [...API.runs_by_sha['sha-m1'], running] }
    const { fetchImpl } = fakeGitHub({ overrides: { runs_by_sha: runsBySha } })
    const events = (await collectRepo(REPO, { ...clients(fetchImpl), now: NOW })).events
    expect(events.filter((e) => e.source === 'speed' && e.id.startsWith('sha-m1:'))).toEqual([])
    // The other merge has no running run, so its rows are still written.
    expect(events.some((e) => e.source === 'speed' && e.id.startsWith('sha-m2:'))).toBe(true)
  })

  it('the collector\'s own in-progress run on the merge commit does not hold back its speed rows', async () => {
    const own = { id: 108, run_attempt: 1, name: 'Metrics daily', event: 'schedule', status: 'in_progress', conclusion: null, head_sha: 'sha-m1', created_at: '2026-11-26T11:00:00Z', run_started_at: '2026-11-26T11:00:05Z', updated_at: '2026-11-26T11:00:05Z', html_url: 'https://github.com/Shaked/x-thread-draft-tool/actions/runs/108', pull_requests: [] }
    const runsBySha = { ...API.runs_by_sha, 'sha-m1': [...API.runs_by_sha['sha-m1'], own] }
    const { fetchImpl } = fakeGitHub({ overrides: { runs_by_sha: runsBySha } })
    const events = (await collectRepo(REPO, { ...clients(fetchImpl), now: NOW })).events
    expect(events.some((e) => e.source === 'speed' && e.id === 'sha-m1:total')).toBe(true)
  })

  it('a merge less than two hours old gets no speed rows yet', async () => {
    const { fetchImpl } = fakeGitHub()
    const oneHourAfterMerge = Date.parse('2026-11-25T11:07:30Z')
    const events = (await collectRepo(REPO, { ...clients(fetchImpl), now: oneHourAfterMerge })).events
    expect(events.filter((e) => e.source === 'speed' && e.id.startsWith('sha-m1:'))).toEqual([])
  })

  it('a rate floor reached inside a merge keeps the events gathered so far; counters and cursor, which need only the listing, are still sent', async () => {
    // Calls 1-4 list the four days, 5 is the jobs call of run 101, 6 the merges, 7 and 8 the first merge's deployment and its status:
    // call 8 answers with 99 left, so the speed request of the same merge must not go out.
    const { fetchImpl } = fakeGitHub({ remaining: 5000, dropAfterCalls: 8 })
    const result = await collectRepo(REPO, { ...clients(fetchImpl), now: NOW })
    const keys = result.events.map((e) => `${e.source}/${e.kind}/${e.id}`)
    expect(result.complete).toBe(false)
    expect(result.countable).toBe(true)
    expect(keys).toEqual(expect.arrayContaining(['ci/run/100.1', 'git/merge/sha-m1', 'deploy/deploy/501']))
    expect(keys.some((k) => k.startsWith('speed/'))).toBe(false)
    expect(result.counters).toHaveLength(4)
    expect(result.cursor).toBe('2026-11-24T11:00:00.000Z')
  })

  it('sends the same bodies the route accepts: every event passes the ingest validator with nothing refused', async () => {
    const { fetchImpl } = fakeGitHub()
    const result = await collectRepo(REPO, { ...clients(fetchImpl), now: NOW })
    const [body] = batchesFor(REPO.repository_id, result)
    const checked = validateBatch(body, { now: NOW })
    expect(checked.ok).toBe(true)
    expect(checked.refused).toEqual([])
    expect(checked.events).toHaveLength(body.events.length)
  })

  it('a duplicate on one page cannot make a day with a missing run look complete', async () => {
    // Day 2026-11-24 holds two distinct runs (102 and 104) but its total_count says three: one run is missing from the
    // answer, and 104 is listed twice in its place. Raw counting would call the day complete; distinct counting must not.
    const { fetchImpl } = fakeGitHub({
      overrides: { runs: [...API.runs, API.runs.find((r) => r.id === 104)] },
      totalExtra: 1,
      totalExtraDay: '2026-11-24'
    })
    const result = await collectRepo(REPO, { ...clients(fetchImpl), now: NOW })
    expect(result.countable).toBe(false)
    expect(result.counters).toEqual([])
    expect(result.cursor).toBeNull()
  })

  it('takes the newest success or failure of a deployment that is now inactive, so it is not dropped', async () => {
    const statuses = {
      ...API.statuses,
      501: [
        { state: 'pending', created_at: '2026-11-25T10:08:01Z' },
        { state: 'success', created_at: '2026-11-25T10:09:00Z' },
        { state: 'inactive', created_at: '2026-11-25T11:00:00Z' }
      ]
    }
    const { fetchImpl } = fakeGitHub({ overrides: { statuses } })
    const events = byKey((await collectRepo(REPO, { ...clients(fetchImpl), now: NOW })).events)
    expect(events['deploy/deploy/501']).toMatchObject({ status: 'success', ms: 60000 })
  })

  it('sends a null duration for a merge longer than the route accepts (2^31 - 1 ms)', async () => {
    const longPr = { number: 9, merged_at: '2026-11-25T10:07:30Z', created_at: '2026-10-01T09:00:00Z', updated_at: '2026-11-25T10:07:30Z', merge_commit_sha: 'sha-long', base: { ref: 'main' }, head: { sha: 'sha-long-head' }, html_url: 'https://github.com/Shaked/x-thread-draft-tool/pull/9' }
    const { fetchImpl } = fakeGitHub({ overrides: { pulls: [longPr], runs_by_sha: {}, files: {}, deployments: {} } })
    const result = await collectRepo(REPO, { ...clients(fetchImpl), now: NOW })
    const merge = byKey(result.events)['git/merge/sha-long']
    expect(merge.ms).toBeNull()
    expect(validateBatch(batchesFor(REPO.repository_id, result)[0], { now: NOW }).refused).toEqual([])
  })

  it('counts a run listed twice (it moved onto another page while the pages were read) once', async () => {
    const duplicated = [...API.runs, API.runs.find((r) => r.id === 104)]
    const { fetchImpl } = fakeGitHub({ overrides: { runs: duplicated } })
    const { counters } = await collectRepo(REPO, { ...clients(fetchImpl), now: NOW })
    expect(counters.find((c) => c.day === '2026-11-24' && c.status === 'cancelled')).toMatchObject({ count: 1 })
  })

  it('an answer that holds fewer runs than its total_count is incomplete: no counters, no cursor', async () => {
    const { fetchImpl } = fakeGitHub({ totalExtra: 5 })
    const result = await collectRepo(REPO, { ...clients(fetchImpl), now: NOW })
    expect(result.countable).toBe(false)
    expect(result.counters).toEqual([])
    expect(result.cursor).toBeNull()
  })

  it('requests a fresh OIDC token before every POST, never reusing one older than the route allows', async () => {
    const calls = { oidc: 0, post: [] }
    const github = fakeGitHub().fetchImpl
    const fetchImpl = async (url, init) => {
      if (url.startsWith('https://oidc.example.test/')) {
        calls.oidc += 1
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ value: `token-${calls.oidc}` }) }
      }
      if (url.startsWith('https://ops.example.test/')) {
        calls.post.push(init.headers.authorization)
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ accepted: 0, refused: 0, cursor: null }) }
      }
      return github(url, init)
    }
    const logs = []
    await run(['--repo', FULL], { GITHUB_TOKEN: 'read-token', ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example.test/token?api-version=2.0', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token', OPS_BASE_URL: 'https://ops.example.test' }, { now: NOW, fetchImpl, log: (l) => logs.push(l) })
    // One POST for the cursor read, one for the batch: each with its own token.
    expect(calls.post).toEqual(['Bearer token-1', 'Bearer token-2'])
    expect(calls.oidc).toBe(2)
    expect(logs.join('\n')).not.toContain('token-')
  })
})
