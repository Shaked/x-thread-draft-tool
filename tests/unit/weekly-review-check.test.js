// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  liveFetchers,
  canonicalJson,
  fingerprintOf,
  fence,
  bumpKind,
  parseOutdated,
  parseAudit,
  parseNpmVersion,
  parseTelegramApi,
  parseNodeLts,
  parseWorkflowNodeVersions,
  readLastFacts,
  planWeeklyReview,
  buildBody,
  collectSignals,
  speedFacts,
  speedFlagged,
} from '../../scripts/weekly-review-check.mjs'
import { buildMessage } from '../../scripts/notify-telegram.mjs'

const FULL = {
  outdated: [{ name: 'zod', current: '3.0.0', latest: '4.0.0', kind: 'major' }],
  audit: { critical: 0, high: 1, moderate: 0, low: 0 },
  pins: { '@vercel/functions': { pinned: '3.10.6', latest: '3.10.6' } },
  telegramApi: '9.2',
  node: { workflow: [20, 22], lts: 24 },
  matrixStale: 0,
}

describe('canonical JSON and fingerprint', () => {
  it('sorts keys at every level, so key order never changes the hash', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3] } })).toBe('{"a":{"c":[3],"d":2},"b":1}')
    expect(fingerprintOf({ a: 1, b: 2 })).toBe(fingerprintOf({ b: 2, a: 1 }))
  })

  it('changes when one fact changes', () => {
    expect(fingerprintOf({ a: 1 })).not.toBe(fingerprintOf({ a: 2 }))
  })
})

describe('text from packages and web pages cannot break the issue body', () => {
  it('replaces backticks inside a fenced block', () => {
    expect(fence(['a `b` c'])).toBe('```text\na \'b\' c\n```')
  })
})

describe('bump kind', () => {
  it('reports major, minor, patch, same and other', () => {
    expect(bumpKind('1.2.3', '2.0.0')).toBe('major')
    expect(bumpKind('1.2.3', '1.3.0')).toBe('minor')
    expect(bumpKind('1.2.3', '1.2.4')).toBe('patch')
    expect(bumpKind('1.2.3', '1.2.3')).toBe('same')
    expect(bumpKind('latest', '1.0.0')).toBe('other')
  })
})

describe('parsers', () => {
  it('npm outdated: an error object from a failed registry request is unreadable, never "nothing outdated"', () => {
    const text = JSON.stringify({ error: { code: 'E503', summary: 'Service Unavailable' } })
    expect(parseOutdated(text)).toBeNull()
  })

  it('npm outdated: a package that happens to be named error is still read', () => {
    const text = JSON.stringify({ error: { current: '1.0.0', latest: '1.1.0' } })
    expect(parseOutdated(text)).toEqual([{ name: 'error', current: '1.0.0', latest: '1.1.0', kind: 'minor' }])
  })

  it('npm outdated: sorted by name, up-to-date packages left out, exit code 1 output is read', () => {
    const text = JSON.stringify({
      zod: { current: '3.0.0', latest: '4.0.0' },
      axios: { current: '1.1.0', latest: '1.1.0' },
      vite: { current: '5.0.0', latest: '5.0.2' },
    })
    expect(parseOutdated(text)).toEqual([
      { name: 'vite', current: '5.0.0', latest: '5.0.2', kind: 'patch' },
      { name: 'zod', current: '3.0.0', latest: '4.0.0', kind: 'major' },
    ])
    expect(parseOutdated(null)).toBeNull()
  })

  it('npm audit: counts by severity', () => {
    const text = JSON.stringify({ metadata: { vulnerabilities: { info: 0, low: 2, moderate: 1, high: 0, critical: 0, total: 3 } } })
    expect(parseAudit(text)).toEqual({ critical: 0, high: 0, moderate: 1, low: 2 })
    expect(parseAudit('{}')).toBeNull()
    expect(parseAudit(null)).toBeNull()
  })

  it('npm view: one version line, anything else is unreadable', () => {
    expect(parseNpmVersion('1.32.2\n')).toBe('1.32.2')
    expect(parseNpmVersion('npm ERR! 404')).toBeNull()
  })

  it('Telegram Bot API: the first "Bot API x.y" heading', () => {
    expect(parseTelegramApi('<h4>Recent changes</h4> Bot API 9.2 ... Bot API 9.1')).toBe('9.2')
    expect(parseTelegramApi('no heading here')).toBeNull()
  })

  it('Node: the newest LTS major from the release index', () => {
    const index = [
      { version: 'v25.1.0', lts: false },
      { version: 'v24.3.0', lts: 'Krypton' },
      { version: 'v22.9.0', lts: 'Jod' },
    ]
    expect(parseNodeLts(index)).toBe(24)
    expect(parseNodeLts(null)).toBeNull()
  })

  it('workflow node-version values: sorted unique majors', () => {
    const files = [
      { name: 'a.yml', text: "node-version: 20\n node-version: '22'" },
      { name: 'b.yml', text: 'node-version: 20' },
    ]
    expect(parseWorkflowNodeVersions(files)).toEqual([20, 22])
  })
})

describe('planWeeklyReview', () => {
  const template = '# Weekly review\n\nRead the rules first.'

  it('first run with readable signals: creates one issue whose body carries the fingerprint and the facts', () => {
    const plan = planWeeklyReview({ current: FULL, lastBody: '', openWeekly: 0, date: '2026-11-30', template })
    expect(plan.action).toBe('create')
    expect(plan.title).toBe('Weekly review 2026-11-30')
    expect(plan.body.startsWith('# Weekly review')).toBe(true)
    expect(plan.body).toContain('zod 3.0.0 -> 4.0.0 (major)')
    expect(plan.body).toContain(`<!-- weekly-fingerprint:${plan.fingerprint} -->`)
    expect(readLastFacts(plan.body)).toEqual(plan.facts)
  })

  it('same facts as the last issue: nothing to do', () => {
    const last = buildBody({ facts: FULL, fingerprint: fingerprintOf(FULL) })
    const plan = planWeeklyReview({ current: FULL, lastBody: last, openWeekly: 0 })
    expect(plan.action).toBe('nochange')
  })

  it('changed facts, no weekly issue open: create', () => {
    const last = buildBody({ facts: FULL, fingerprint: fingerprintOf(FULL) })
    const changed = { ...FULL, telegramApi: '9.3' }
    expect(planWeeklyReview({ current: changed, lastBody: last, openWeekly: 0 }).action).toBe('create')
  })

  it('one review per week: a weekly issue opened within 7 days blocks a new one, even when it has closed', () => {
    const last = buildBody({ facts: FULL, fingerprint: fingerprintOf(FULL) })
    const changed = { ...FULL, telegramApi: '9.3' }
    const now = new Date('2026-12-02T12:00:00Z')
    const plan = planWeeklyReview({ current: changed, lastBody: last, openWeekly: 0, lastCreatedAt: '2026-11-30T05:23:00Z', now })
    expect(plan.action).toBe('this-week')
  })

  it('one review per week: a run a few minutes short of 7 days after the last issue still opens (cron delay must not skip a week)', () => {
    const last = buildBody({ facts: FULL, fingerprint: fingerprintOf(FULL) })
    const changed = { ...FULL, telegramApi: '9.3' }
    // Last issue opened late on Monday 05:45; this Monday's scheduled run starts on time at 05:24, 6 days 23h 39m later.
    const now = new Date('2026-12-07T05:24:00Z')
    expect(planWeeklyReview({ current: changed, lastBody: last, openWeekly: 0, lastCreatedAt: '2026-11-30T05:45:00Z', now }).action).toBe('create')
  })

  it('one review per week: 7 days after the newest weekly issue, a changed review may open', () => {
    const last = buildBody({ facts: FULL, fingerprint: fingerprintOf(FULL) })
    const changed = { ...FULL, telegramApi: '9.3' }
    const now = new Date('2026-12-07T05:30:00Z')
    expect(planWeeklyReview({ current: changed, lastBody: last, openWeekly: 0, lastCreatedAt: '2026-11-30T05:23:00Z', now }).action).toBe('create')
  })

  it('changed facts, but a weekly issue is still open: still-open, no new issue', () => {
    const last = buildBody({ facts: FULL, fingerprint: fingerprintOf(FULL) })
    const changed = { ...FULL, telegramApi: '9.3' }
    expect(planWeeklyReview({ current: changed, lastBody: last, openWeekly: 1 }).action).toBe('still-open')
  })

  it('an unreadable source is carried from the last issue, so it never opens an issue by itself', () => {
    const last = buildBody({ facts: FULL, fingerprint: fingerprintOf(FULL) })
    const unread = { ...FULL, audit: null }
    const plan = planWeeklyReview({ current: unread, lastBody: last, openWeekly: 0 })
    expect(plan.action).toBe('nochange')
    expect(plan.unreadable).toEqual(['audit'])
  })

  it('an unreadable source with a real change elsewhere: create, and the body names the unreadable source', () => {
    const last = buildBody({ facts: FULL, fingerprint: fingerprintOf(FULL) })
    const plan = planWeeklyReview({ current: { ...FULL, telegramApi: '9.3', audit: null }, lastBody: last, openWeekly: 0 })
    expect(plan.action).toBe('create')
    expect(plan.body).toContain('Unreadable this week (value carried from the last issue): audit')
  })

  it('when no source can be read at all, nothing is opened, even on a first run', () => {
    const none = Object.fromEntries(Object.keys(FULL).map((k) => [k, null]))
    expect(planWeeklyReview({ current: none, lastBody: '', openWeekly: 0 }).action).toBe('nochange')
  })

  it('a CRLF last body (saved by GitHub after an edit) is read like the LF one', () => {
    const last = buildBody({ facts: FULL, fingerprint: fingerprintOf(FULL) }).replace(/\n/g, '\r\n')
    expect(readLastFacts(last)).toEqual(FULL)
    expect(planWeeklyReview({ current: { ...FULL, audit: null }, lastBody: last, openWeekly: 0 }).action).toBe('nochange')
  })

  it('an untrusted last body with an unreadable source now never opens an issue', () => {
    const last = buildBody({ facts: FULL, fingerprint: fingerprintOf(FULL) }).replace('"telegramApi": "9.2"', '"telegramApi": "0.0"')
    expect(planWeeklyReview({ current: { ...FULL, audit: null }, lastBody: last, openWeekly: 0 }).action).toBe('nochange')
  })

  it('a last body whose facts do not match its marker is ignored (it cannot be trusted)', () => {
    const forged = buildBody({ facts: FULL, fingerprint: fingerprintOf(FULL) }).replace('"telegramApi": "9.2"', '"telegramApi": "0.0"')
    expect(readLastFacts(forged)).toBeNull()
  })

  it('package names with backticks cannot close the fenced block of the issue body', () => {
    const facts = { ...FULL, outdated: [{ name: 'x`y', current: '1.0.0', latest: '2.0.0', kind: 'major' }] }
    const body = buildBody({ facts, fingerprint: fingerprintOf(facts) })
    expect(body).toContain("x'y 1.0.0 -> 2.0.0 (major)")
    expect(readLastFacts(body)).toEqual(facts)
  })
})

describe('collectSignals', () => {
  it('a fetcher that throws is recorded as unreadable, and the others still run', async () => {
    const out = await collectSignals({
      ok: async () => 42,
      boom: async () => {
        throw new Error('network')
      },
      empty: async () => undefined,
    })
    expect(out).toEqual({ ok: 42, boom: null, empty: null })
  })
})

// A speed.json as scripts/speed-metrics.mjs writes it (only the fields the check reads, plus the table).
// `change` is null when no previous file was given, as the script writes it.
function speedDoc({ ciP90 = 80, ciMedian = 100, ciOver = false, ciChange = null, totalOver = false } = {}) {
  const stat = (median, p90, over, limit, change = null) => ({ n: 5, median, p90, limit, over, change })
  return {
    mode: 'since 7d',
    summary: {
      code: {
        count: 5,
        ci: stat(ciMedian, ciP90, ciOver, 90, ciChange),
        merge_wait: stat(3, 6, false, null),
        vercel: stat(22, 23, false, 35),
        smoke: stat(21, 30, false, 25),
        total: stat(177, 206, totalOver, 150),
      },
      docs: { count: 2, ci: stat(40, 50, false, 90), merge_wait: stat(2, 3, false, null), vercel: null, smoke: null, total: stat(147, 169, false, 90) },
    },
  }
}
const SPEED_TABLE = '| Kind | Stage | p90 |\n|---|---|---|\n| Product code | CI | 80 s |'

describe('speed signal (task S7, #315): booleans per stage, seconds never in the fingerprint', () => {
  it('no flags: every stage is over=false and slower=false', () => {
    const f = speedFacts(speedDoc())
    expect(f.code.ci).toEqual({ over: false, slower: false })
    expect(f.code.total).toEqual({ over: false, slower: false })
    expect(f.docs.ci).toEqual({ over: false, slower: false })
    expect(speedFlagged(f)).toBe(false)
  })

  it('over: a stage whose p90 is over its limit is flagged over', () => {
    const f = speedFacts(speedDoc({ ciOver: true, ciP90: 167 }))
    expect(f.code.ci.over).toBe(true)
    expect(speedFlagged(f)).toBe(true)
  })

  it('slower: a change marked slower by the speed script is flagged slower', () => {
    const f = speedFacts(speedDoc({ ciChange: { delta: 30, slower: true } }))
    expect(f.code.ci.slower).toBe(true)
    expect(f.code.ci.over).toBe(false)
    expect(speedFlagged(f)).toBe(true)
  })

  it('missing previous artifact: no change means slower is false for every stage, which is not a change', () => {
    const f = speedFacts(speedDoc({ ciChange: null }))
    expect(Object.values(f).flatMap((stages) => Object.values(stages)).every((s) => s.slower === false)).toBe(true)
  })

  it('seconds alone never change the fingerprint: same flags, different medians and p90s give the same facts', () => {
    const a = speedFacts(speedDoc({ ciMedian: 100, ciP90: 80 }))
    const b = speedFacts(speedDoc({ ciMedian: 118, ciP90: 85 }))
    expect(fingerprintOf({ speed: a })).toBe(fingerprintOf({ speed: b }))
  })

  it('an unreadable or empty speed document is unreadable (null), never "no flags"', () => {
    expect(speedFacts(null)).toBeNull()
    expect(speedFacts({})).toBeNull()
    expect(speedFacts({ summary: {} })).toBeNull()
  })

  it('a flag that changed opens an issue whose body carries the speed table in a fence', () => {
    const plan = planWeeklyReview({
      current: { ...FULL, speed: speedFacts(speedDoc({ ciOver: true })) },
      lastBody: '',
      openWeekly: 0,
      date: '2026-11-30',
      speedMd: SPEED_TABLE,
    })
    expect(plan.action).toBe('create')
    expect(plan.body).toContain('Speed, last 7 days: 1 stage(s) over the limit, 0 slower than last week')
    expect(plan.body).toContain('```text\n| Kind | Stage | p90 |')
    expect(readLastFacts(plan.body)).toEqual(plan.facts)
  })

  it('no speed flag: the body has no speed table, even when a table is given', () => {
    const plan = planWeeklyReview({
      current: { ...FULL, speed: speedFacts(speedDoc()) },
      lastBody: '',
      openWeekly: 0,
      date: '2026-11-30',
      speedMd: SPEED_TABLE,
    })
    expect(plan.action).toBe('create')
    expect(plan.body).not.toContain('| Kind | Stage | p90 |')
  })

  it('a speed flag that clears is a fingerprint change: the review opens, without a speed table (no flag is set)', () => {
    const overFacts = { ...FULL, speed: speedFacts(speedDoc({ ciOver: true })) }
    const last = buildBody({ facts: overFacts, fingerprint: fingerprintOf(overFacts) })
    const plan = planWeeklyReview({ current: { ...FULL, speed: speedFacts(speedDoc()) }, lastBody: last, openWeekly: 0, speedMd: SPEED_TABLE })
    expect(plan.action).toBe('create')
    expect(plan.body).not.toContain('| Kind | Stage | p90 |')
  })

  it('flagged, cleared, flagged again: every change opens a review, so a slowdown that comes back is reported', () => {
    const noFlags = { ...FULL, speed: speedFacts(speedDoc()) }
    const flagged = { ...FULL, speed: speedFacts(speedDoc({ ciOver: true })) }
    const issueA = buildBody({ facts: flagged, fingerprint: fingerprintOf(flagged) })
    const cleared = planWeeklyReview({ current: noFlags, lastBody: issueA, openWeekly: 0 })
    expect(cleared.action).toBe('create')
    const again = planWeeklyReview({ current: flagged, lastBody: cleared.body, openWeekly: 0 })
    expect(again.action).toBe('create')
  })

  it('a speed flag that clears together with another change still opens the review', () => {
    const overFacts = { ...FULL, speed: speedFacts(speedDoc({ ciOver: true })) }
    const last = buildBody({ facts: overFacts, fingerprint: fingerprintOf(overFacts) })
    const plan = planWeeklyReview({ current: { ...FULL, telegramApi: '9.3', speed: speedFacts(speedDoc()) }, lastBody: last, openWeekly: 0 })
    expect(plan.action).toBe('create')
  })

  it('a new speed flag opens the review', () => {
    const last = buildBody({ facts: FULL, fingerprint: fingerprintOf(FULL) })
    const plan = planWeeklyReview({ current: { ...FULL, speed: speedFacts(speedDoc({ ciOver: true })) }, lastBody: last, openWeekly: 0 })
    expect(plan.action).toBe('create')
  })

  it('the live speed fetcher: no SPEED_FILE, or a malformed file, is unreadable (null), never "no flags"', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'speed-fetch-'))
    const bad = join(dir, 'speed.json')
    writeFileSync(bad, '{ not json')
    expect(await liveFetchers(process.cwd(), '').speed()).toBeNull()
    expect(await liveFetchers(process.cwd(), join(dir, 'missing.json')).speed()).toBeNull()
    expect(await liveFetchers(process.cwd(), bad).speed()).toBeNull()
  })

  it('an unreadable speed.json is carried from the last issue and never opens an issue by itself', () => {
    const last = buildBody({ facts: { ...FULL, speed: speedFacts(speedDoc()) }, fingerprint: fingerprintOf({ ...FULL, speed: speedFacts(speedDoc()) }) })
    const plan = planWeeklyReview({ current: { ...FULL, speed: null }, lastBody: last, openWeekly: 0 })
    expect(plan.action).toBe('nochange')
    expect(plan.unreadable).toEqual(['speed'])
  })
})

describe('the weekly-started Telegram line', () => {
  it('links to the issue, then the title, and says nothing is needed', () => {
    const msg = buildMessage('weekly-started', { title: 'Weekly review 2026-11-30', url: 'https://github.com/Shaked/x-thread-draft-tool/issues/1' })
    expect(msg.plain).toContain('Weekly review started')
    expect(msg.plain).toContain('Weekly review 2026-11-30')
    expect(msg.plain).toContain('opens up to three PRs')
    expect(msg.plain).not.toMatch(/nothing needed/i)
  })
})
