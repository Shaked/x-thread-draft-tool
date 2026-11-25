// @vitest-environment node
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { shouldSkip } from '../../scripts/vercel-ignore.mjs'
import {
  addTrend,
  githubApi,
  measurePull,
  nearestRank,
  median,
  overLimit,
  run,
  summarize,
} from '../../scripts/speed-metrics.mjs'

// Task S5 (#310): the stage math, the kinds, the limits and the output of scripts/speed-metrics.mjs.
// The API sample is a saved, trimmed copy of the GitHub REST shapes, built by hand (no logins, no emails).
const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/speed/api.json', import.meta.url), 'utf8'))
const M = Object.fromEntries(FIXTURE.pulls.map((p) => [p.number, p.merge_commit_sha]))
const NOW = Date.parse('2026-11-25T00:00:00Z')

// Answers like the REST client, from the sample. Nothing else is read.
function fakeApi(fixture = FIXTURE) {
  return {
    async recentMergedPulls({ count = 0, sinceMs = 0 }) {
      const list = fixture.pulls
        .filter((p) => p.merged_at && Date.parse(p.merged_at) >= sinceMs)
        .sort((a, b) => Date.parse(b.merged_at) - Date.parse(a.merged_at))
      return count ? list.slice(0, count) : list
    },
    async pullForMergeSha(sha) {
      return fixture.pulls.find((p) => p.merge_commit_sha === sha) ?? null
    },
    async runsForSha(sha) {
      return fixture.runs[sha] ?? []
    },
    async deploymentsForSha(sha) {
      return fixture.deployments[sha] ?? []
    },
    async deploymentStatuses(id) {
      return fixture.statuses[id] ?? []
    },
    async commitFiles(sha) {
      return fixture.files[sha] ?? []
    },
  }
}

const pullByNumber = (n) => FIXTURE.pulls.find((p) => p.number === n)
const measure = (n) => measurePull(pullByNumber(n), fakeApi())

describe('nearest rank and median (plan section 1)', () => {
  it('p90 of 9 values is the largest; of 10 values, the 9th', () => {
    expect(nearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9], 90)).toBe(9)
    expect(nearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9)
    expect(nearestRank([], 90)).toBeNull()
  })

  it('median of an even count is the rounded mean of the two middle values', () => {
    expect(median([58, 87, 93, 99])).toBe(90)
    expect(median([5, 1, 3])).toBe(3)
    expect(median([])).toBeNull()
  })
})

describe('stage math for one merged pull request', () => {
  it('PR 101: CI from the first run of each workflow, merge wait, Vercel and smoke', async () => {
    const pr = await measure(101)
    expect(pr.kind).toBe('code')
    expect(pr.stages.ci).toEqual({ running: 93, queue: 2 })
    // The later Net lines run (updated 10:05:00) is waiting, not CI: CI ends at 10:01:35.
    expect(pr.stages.merge).toEqual({ running: 0, wait: 35 })
    expect(pr.stages.vercel).toEqual({ running: 21 })
    expect(pr.stages.smoke).toEqual({ running: 22, queue: 2 })
    expect(pr.total).toBe(136)
    expect(pr.flags).toEqual([])
  })

  it('PR 102: a smoke re-run uses the latest attempt start, and the wait before it is queue time', async () => {
    const pr = await measure(102)
    expect(pr.stages.ci).toEqual({ running: 99, queue: 1 })
    expect(pr.stages.merge.wait).toBe(30)
    expect(pr.stages.vercel.running).toBe(20)
    expect(pr.stages.smoke).toEqual({ running: 20, queue: 90 })
    expect(pr.total).toBe(139)
  })

  it('PR 101: a skipped smoke run from a pending status does not stand in for the real smoke run', async () => {
    const withSkipped = structuredClone(FIXTURE)
    withSkipped.runs[M[101]].unshift({
      id: 2199,
      name: 'Smoke test (deployed)',
      event: 'deployment_status',
      run_attempt: 1,
      conclusion: 'skipped',
      created_at: '2026-11-20T10:02:12Z',
      run_started_at: '2026-11-20T10:02:12Z',
      updated_at: '2026-11-20T10:02:12Z',
    })
    const pr = await measurePull(pullByNumber(101), fakeApi(withSkipped))
    expect(pr.stages.smoke).toEqual({ running: 22, queue: 2 })
  })

  it('PR 103: a merge before CI ended is flagged and its wait is clamped to 0', async () => {
    const pr = await measure(103)
    expect(pr.stages.merge).toEqual({ running: 0, wait: 0 })
    expect(pr.flags).toEqual(['negative_wait'])
    expect(pr.total).toBe(100)
  })

  it('PR 104 is docs-only: only CI counts, and there is no Vercel or smoke stage', async () => {
    const pr = await measure(104)
    expect(pr.kind).toBe('docs')
    expect(pr.stages.ci.running).toBe(79)
    expect(pr.stages.merge.wait).toBe(25)
    expect(pr.stages.vercel).toBeNull()
    expect(pr.stages.smoke).toBeNull()
    expect(pr.total).toBe(79)
  })

  it('PR 105 has no smoke run: flagged, and the total is not computed', async () => {
    const pr = await measure(105)
    expect(pr.stages.vercel.running).toBe(25)
    expect(pr.stages.smoke).toBeNull()
    expect(pr.total).toBeNull()
    expect(pr.flags).toEqual(['missing_smoke'])
  })
})

describe('summary and limits', () => {
  it('the code CI p90 is over its 90 s limit; Vercel, smoke and total are within', async () => {
    const records = await Promise.all([101, 102, 103, 104, 105].map(measure))
    const summary = summarize(records)
    expect(summary.code.count).toBe(4)
    expect(summary.code.ci).toMatchObject({ n: 4, median: 90, p90: 99, limit: 90, over: true })
    expect(summary.code.vercel).toMatchObject({ n: 4, p90: 25, limit: 35, over: false })
    expect(summary.code.smoke).toMatchObject({ n: 3, p90: 22, limit: 25, over: false })
    expect(summary.code.total).toMatchObject({ n: 3, p90: 139, limit: 150, over: false })
    expect(summary.docs.count).toBe(1)
    expect(summary.docs.total).toMatchObject({ n: 1, median: 79, limit: 90, over: false })
  })

  it('overLimit names only the stages above their limit, with the value and the limit', () => {
    const record = { kind: 'code', stages: { ci: { running: 80 }, merge: null, vercel: { running: 40 }, smoke: { running: 20 } }, total: 140 }
    expect(overLimit(record)).toEqual([{ stage: 'vercel', value: 40, limit: 35 }])
    expect(overLimit({ ...record, stages: { ...record.stages, vercel: { running: 20 } } })).toEqual([])
  })
})

describe('trend against an earlier run', () => {
  it('a median 30 s higher than 20 % or more is slower; 10 s higher is not', async () => {
    const summary = summarize(await Promise.all([101, 102, 103, 104, 105].map(measure)))
    // current code CI median is 90
    const fromSixty = addTrend(summary, { code: { ci: { median: 60 } } })
    expect(fromSixty.code.ci.change).toEqual({ delta: 30, slower: true })
    const fromEighty = addTrend(summary, { code: { ci: { median: 80 } } })
    expect(fromEighty.code.ci.change).toEqual({ delta: 10, slower: false })
    expect(addTrend(summary, null).code.ci.change).toBeNull()
  })
})

describe('run(): modes, output and the checks', () => {
  function tmp() {
    return mkdtempSync(join(tmpdir(), 'speed-'))
  }

  it('--last 2 takes the two most recent merges', async () => {
    const out = tmp()
    const result = await run(['--last', '2', '--out', out], {}, { api: fakeApi(), now: NOW, log: () => {}, notifyImpl: async () => 'skipped' })
    expect(result.status).toBe('done')
    const doc = JSON.parse(readFileSync(join(out, 'speed.json'), 'utf8'))
    expect(doc.prs.map((p) => p.number)).toEqual([104, 105])
    expect(doc.mode).toBe('last 2')
  })

  it('--last prints the p90 table to the log, so the job log shows the numbers', async () => {
    const lines = []
    await run(['--last', '2', '--out', tmp()], {}, { api: fakeApi(), now: NOW, log: (line) => lines.push(line), notifyImpl: async () => 'skipped' })
    expect(lines.join('\n')).toContain('| Kind | Stage | n | Median | p90 | p90 limit | Over | Change |')
  })

  it('the same sample gives byte-identical speed.json and speed.md', async () => {
    const a = tmp()
    const b = tmp()
    const opts = { api: fakeApi(), now: NOW, log: () => {}, notifyImpl: async () => 'skipped' }
    await run(['--since', '7d', '--out', a], {}, opts)
    await run(['--since', '7d', '--out', b], {}, opts)
    expect(readFileSync(join(a, 'speed.json'), 'utf8')).toBe(readFileSync(join(b, 'speed.json'), 'utf8'))
    expect(readFileSync(join(a, 'speed.md'), 'utf8')).toBe(readFileSync(join(b, 'speed.md'), 'utf8'))
  })

  it('--previous adds the change per stage to the table', async () => {
    const first = tmp()
    const opts = { api: fakeApi(), now: NOW, log: () => {}, notifyImpl: async () => 'skipped' }
    await run(['--last', '5', '--out', first], {}, opts)
    const previous = join(first, 'speed.json')
    writeFileSync(previous, readFileSync(previous, 'utf8').replace('"median": 90', '"median": 60'))
    const second = tmp()
    await run(['--last', '5', '--previous', previous, '--out', second], {}, opts)
    const md = readFileSync(join(second, 'speed.md'), 'utf8')
    expect(md).toMatch(/\| Product code \| CI \| 4 \| 90 s \| 99 s \| 90 s \| yes \| \+30 s \(slower\) \|/)
  })

  it('--merge of a production merge warns for CI 93 s over 90 s, and sends no Telegram line', async () => {
    const sent = []
    const logs = []
    const result = await run(['--merge', M[101], '--out', tmp()], {}, {
      api: fakeApi(), now: NOW, log: (l) => logs.push(l), notifyImpl: async (m) => sent.push(m),
    })
    expect(result.status).toBe('done')
    expect(logs.filter((l) => l.startsWith('::warning'))).toEqual(['::warning title=Speed budget::#101 CI 93 s is over the limit of 90 s'])
    expect(sent).toEqual([])
  })

  it('--merge skips a docs-only merge and an unknown commit', async () => {
    const logs = []
    const opts = { api: fakeApi(), now: NOW, log: (l) => logs.push(l), notifyImpl: async () => 'skipped' }
    expect((await run(['--merge', M[104], '--out', tmp()], {}, opts)).status).toBe('skipped')
    expect((await run(['--merge', 'f'.repeat(40), '--out', tmp()], {}, opts)).status).toBe('skipped')
    expect(logs.length).toBe(2)
  })

  it('--last sends one speed line when a stage is over its p90 limit, with the stage names only', async () => {
    const sent = []
    await run(['--last', '5', '--out', tmp()], { GITHUB_REPOSITORY: 'owner/repo', GITHUB_RUN_ID: '42' }, {
      api: fakeApi(), now: NOW, log: () => {}, notifyImpl: async (m) => sent.push(m),
    })
    expect(sent).toHaveLength(1)
    expect(sent[0].html).toContain('Speed budget over limit')
    expect(sent[0].html).toContain('p90 over the limit: CI')
    expect(sent[0].html).toContain('https://github.com/owner/repo/actions/runs/42')
  })

  it('rejects options it does not know and out-of-range numbers', async () => {
    const opts = { api: fakeApi(), now: NOW, log: () => {}, notifyImpl: async () => 'skipped' }
    await expect(run(['--last', '0'], {}, opts)).rejects.toThrow('--last')
    await expect(run(['--merge', 'abc'], {}, opts)).rejects.toThrow('--merge')
    await expect(run(['--delete', 'x'], {}, opts)).rejects.toThrow('bad option')
  })
})

describe('githubApi.recentMergedPulls paging', () => {
  // A fake fetch that serves the pages of pulls by the page query parameter.
  function pagesApi(pages) {
    const fetchImpl = async (url) => {
      const page = Number(new URL(url).searchParams.get('page'))
      return { ok: true, status: 200, json: async () => pages[page - 1] ?? [] }
    }
    return githubApi({ token: 'test-token', repo: 'owner/repo', fetchImpl })
  }
  const at = (ms) => new Date(ms).toISOString()
  const T = Date.parse('2026-11-24T10:00:00Z')

  it('--last 1 keeps paging past old merges that were updated recently (Codex P2)', async () => {
    // Page 1: 100 old merges (merged in October), all updated in the last hour.
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      number: 1000 - i,
      merged_at: '2026-10-01T00:00:00Z',
      updated_at: at(T - i * 1000),
      merge_commit_sha: 'a'.repeat(40),
      head: { sha: 'b'.repeat(40) },
    }))
    // Page 2: yesterday's merge, updated a week ago.
    const newest = { number: 1, merged_at: '2026-11-23T09:00:00Z', updated_at: '2026-11-23T09:00:00Z', merge_commit_sha: 'c'.repeat(40), head: { sha: 'd'.repeat(40) } }
    const api = pagesApi([page1, [newest]])
    const result = await api.recentMergedPulls({ count: 1 })
    expect(result.map((p) => p.number)).toEqual([1])
  })

  it('--last stops paging when the page is old enough, and returns the newest merges', async () => {
    const page = [
      { number: 5, merged_at: '2026-11-20T00:00:00Z', updated_at: '2026-11-21T00:00:00Z', merge_commit_sha: 'e'.repeat(40), head: { sha: 'f'.repeat(40) } },
      { number: 4, merged_at: '2026-11-19T00:00:00Z', updated_at: '2026-11-19T12:00:00Z', merge_commit_sha: 'e'.repeat(40), head: { sha: 'f'.repeat(40) } },
    ]
    const api = pagesApi([page, [{ number: 99, merged_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }]])
    const result = await api.recentMergedPulls({ count: 2 })
    expect(result.map((p) => p.number)).toEqual([5, 4])
  })
})

describe('githubApi.commitFiles renames', () => {
  it('a rename from a deployed path into docs/ keeps the old path, so the merge is not called docs-only', async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ files: [{ filename: 'docs/llms.txt', previous_filename: 'public/llms.txt' }] }),
    })
    const api = githubApi({ token: 'test-token', repo: 'owner/repo', fetchImpl })
    const files = await api.commitFiles('a'.repeat(40))
    expect(files).toEqual(['docs/llms.txt', 'public/llms.txt'])
    expect(shouldSkip({ VERCEL_ENV: 'production' }, files)).toBe(false)
  })
})

describe('githubApi.commitFiles pages', () => {
  it('a product file on the second page of a large merge is still seen', async () => {
    const pages = [
      Array.from({ length: 100 }, (_, i) => ({ filename: `docs/page-${i}.md` })),
      [{ filename: 'src/app.js' }],
    ]
    const fetchImpl = async (url) => {
      const page = Number(new URL(url).searchParams.get('page'))
      return { ok: true, status: 200, json: async () => ({ files: pages[page - 1] ?? [] }) }
    }
    const api = githubApi({ token: 'test-token', repo: 'owner/repo', fetchImpl })
    const files = await api.commitFiles('a'.repeat(40))
    expect(files).toHaveLength(101)
    expect(shouldSkip({ VERCEL_ENV: 'production' }, files)).toBe(false)
  })
})
