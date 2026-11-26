// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
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

describe('the weekly-started Telegram line', () => {
  it('links to the issue, then the title, and says nothing is needed', () => {
    const msg = buildMessage('weekly-started', { title: 'Weekly review 2026-11-30', url: 'https://github.com/Shaked/x-thread-draft-tool/issues/1' })
    expect(msg.plain).toContain('Weekly review started')
    expect(msg.plain).toContain('Weekly review 2026-11-30')
    expect(msg.plain).toContain('Nothing needed.')
  })
})
