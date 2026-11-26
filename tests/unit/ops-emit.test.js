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

/** A fake GitHub: answers each REST path from the fixture. Every URL it is asked for is recorded. */
function fakeGitHub({ remaining } = {}) {
  const asked = []
  const fetchImpl = async (url) => {
    asked.push(url)
    const u = new URL(url)
    const path = u.pathname.replace(`/repos/${FULL}`, '')
    const q = u.searchParams
    if (path === '/actions/runs') {
      const sha = q.get('head_sha')
      return response({ workflow_runs: sha ? API.runs_by_sha[sha] ?? [] : API.runs }, remaining)
    }
    const jobs = path.match(/^\/actions\/runs\/(\d+)\/jobs$/)
    if (jobs) return response({ jobs: API.jobs[jobs[1]] ?? [] }, remaining)
    if (path === '/pulls') return response(API.pulls, remaining)
    if (path === '/deployments') return response(API.deployments[q.get('sha')] ?? [], remaining)
    const statuses = path.match(/^\/deployments\/(\d+)\/statuses$/)
    if (statuses) return response(API.statuses[statuses[1]] ?? [], remaining)
    const commit = path.match(/^\/commits\/([^/]+)$/)
    if (commit) return response({ files: API.files[commit[1]] ?? [] }, remaining)
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
    expect(bodies[0].counters).toHaveLength(3)
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
