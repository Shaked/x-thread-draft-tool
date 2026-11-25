// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  analyze,
  dependencies,
  names,
  commentFacts,
  taskId,
  shortName,
  order,
  formatReport,
  describeAll,
  fetchSnapshot,
  wrap
} from '../../scripts/janitor.mjs'
import { lint } from '../../scripts/reply-lint.mjs'

const snapshot = JSON.parse(readFileSync(new URL('./fixtures/janitor/snapshot.json', import.meta.url), 'utf8'))
const TODAY = '2026-11-25T12:00:00Z'
const findings = analyze(snapshot, { today: TODAY, knownTables: ['widget_rows'] })
const find = (kind, ...issues) => findings.filter((f) => f.kind === kind && issues.every((n) => f.issues.includes(n)))

describe('analyze on the fixture issues', () => {
  it('finds the duplicate pair and lets the agent close the newer one', () => {
    const [dup] = find('duplicate', 11, 12)
    expect(dup.what).toContain('the same title')
    expect(dup.fix).toContain('close {#12} as a duplicate of {#11}')
    expect(dup.act).toBe('allowed')
  })

  it('finds the dependency cycle and leaves both tasks out of the order', () => {
    expect(find('cycle', 13, 14)).toHaveLength(1)
    const result = order(snapshot)
    expect(result.left).toEqual([13, 14])
    expect(result.order).toContain(11)
    expect(result.order).not.toContain(40)
  })

  it('finds the shipped-open issue from its done HANDOFF and merged PR', () => {
    const [shipped] = find('shipped', 15)
    expect(shipped.what).toContain('PR {#50} is merged')
    expect(shipped.act).toBe('allowed')
  })

  it('reports a merged PR that names an open issue, without allowing a close', () => {
    const [hint] = find('shipped', 20, 51)
    expect(hint.act).toBe('dispatcher')
  })

  it('finds the stale issue and the stale claim', () => {
    expect(find('stale', 16)[0].what).toContain('85 days')
    expect(find('stale', 11)).toHaveLength(0)
    expect(find('claim', 21)[0].what).toContain('older than 3 hours')
    expect(find('claim', 15)).toHaveLength(0)
  })

  it('finds missing dependency lines and a dependency closed as not planned', () => {
    expect(find('missing-dependency', 18, 19)[0].fix).toBe('Add `Depends on: #19`.')
    expect(find('missing-dependency', 22, 19)[0].fix).toBe('Add `Depends on: #19` to {#22}.')
    expect(find('dependency', 18, 40)[0].what).toContain('closed as not planned')
    expect(findings.some((f) => f.issues.includes(99) || f.issues.includes(50) && f.kind === 'dependency')).toBe(false)
  })

  it('finds the overlap across epics with the exact table and route', () => {
    const [overlap] = find('overlap', 11, 22)
    expect(overlap.what).toContain('`widget_rows`')
    expect(overlap.what).toContain('`/api/widgets`')
    expect(find('overlap', 11, 12)).toHaveLength(0)
  })

  it('finds label, held, orphan and limit problems', () => {
    expect(find('labels', 20)[0]).toMatchObject({ fix: 'Add the label `task`.', act: 'allowed' })
    expect(find('labels', 22)[0].act).toBe('owner')
    expect(find('held', 17)).toHaveLength(1)
    expect(find('held', 22)).toHaveLength(0)
    expect(find('orphan', 23)).toHaveLength(1)
    expect(find('limit', 10)[0].what).toContain('95 of 100')
  })

  it('gives the same findings for the same input', () => {
    expect(analyze(snapshot, { today: TODAY, knownTables: ['widget_rows'] })).toEqual(findings)
  })
})

describe('parsers', () => {
  it('reads dependencies and skips PRs, "see" links, code spans and later fields', () => {
    const d = dependencies('Depends on: #5 (A1), PR #6, M5 (see #7), C2 (#8) and `#9`. Done when: #10 closes.\nGoes before #11.')
    expect(d.refs).toEqual([5, 8])
    expect(d.named).toEqual(['M5'])
    expect(d.before).toEqual([11])
  })

  it('ignores "before" that is not a clause start or is negated, and negated or later-field dependencies', () => {
    expect(dependencies('Do not start this before #2 is merged.').before).toEqual([])
    expect(dependencies('Wait until before #2 ships. Goes before #3.').before).toEqual([3])
    expect(dependencies('Depends on #12; done when #13 closes.').refs).toEqual([12])
    expect(dependencies('Depends on: #5. Blocked by #6.').refs).toEqual([5, 6])
    expect(dependencies('Depends on: #359 merged. Server only: it does not wait for #327.').refs).toEqual([359])
    expect(dependencies('Depends on: none (#278 is merged). Goes before #279 resumes.')).toMatchObject({ refs: [278], before: [279] })
    expect(dependencies('This is no longer depends on #5. Not blocked by A2.')).toMatchObject({ refs: [], named: [] })
  })

  it('reads files, routes and tables', () => {
    const body = 'Migration `db/migrations/011_x.sql` creates `ops_events`, `ops_daily` exactly: key (`repo_id`).\n`POST /api/ops/events` and `/admin/metrics`; `AGENTS.md`; `tests/api/x.test.js`.'
    expect(names(body).sort()).toEqual(['/admin/metrics', '/api/ops/events', 'db/migrations/011_x.sql', 'ops_daily', 'ops_events'])
  })

  it('reads task ids and short names', () => {
    expect(taskId({ title: 'E273 task L1 (b): cheap check' })).toEqual({ id: 'L1 (b)', prefix: 273 })
    expect(taskId({ title: 'E407 task M1: ops events tables' })).toEqual({ id: 'M1', prefix: 407 })
    expect(taskId({ title: 'Queue: what the agents do next' })).toBeNull()
    expect(shortName({ title: 'Epic: widgets' })).toBe('Epic widgets issue')
    expect(shortName({ title: 'E407 task M1: ops events tables, event shape and sources list (central metrics)' })).toBe('ops events tables, event shape')
  })

  it('counts a HANDOFF as done only for an exact final status and a trusted author', () => {
    const at = (body, extra = {}) => ({ created_at: '2026-11-25T01:00:00Z', author_association: 'OWNER', body, ...extra })
    expect(commentFacts([at('HANDOFF A5 (part 1 - done) - partial\nRELEASE')]).last.done).toBe(false)
    expect(commentFacts([at('HANDOFF A5 - done, except the route (partial)\nRELEASE')]).last.done).toBe(false)
    expect(commentFacts([at('HANDOFF A5 (shipped) - done\nRELEASE')]).last.done).toBe(true)
    expect(commentFacts([at('HANDOFF A5 - done\nPR: #50\nRELEASE', { author_association: 'NONE', user: 'stranger' })]).last).toBeNull()
    expect(commentFacts([at('HANDOFF A5 - done\nRELEASE', { author_association: undefined, user: 'Shaked' })]).last.done).toBe(true)
  })

  it('reads comments in time order, whatever the array order', () => {
    const f = commentFacts([
      { created_at: '2026-11-25T05:00:00Z', author_association: 'OWNER', body: 'HANDOFF A5 - partial\nRELEASE' },
      { created_at: '2026-11-25T01:00:00Z', author_association: 'OWNER', body: 'HANDOFF A5 - done\nRELEASE' }
    ])
    expect(f.last.done).toBe(false)
  })

  it('reads HANDOFF status and CLAIM heartbeat', () => {
    const f = commentFacts([
      { created_at: '2026-11-25T01:00:00Z', body: 'CLAIM session s | heartbeat 2026-11-25 03:00 UTC' },
      { created_at: '2026-11-25T04:00:00Z', author_association: 'OWNER', body: 'HANDOFF S6 (gate) - not started, waiting\nRELEASE' }
    ])
    expect(f.claim).toMatchObject({ heartbeat: '2026-11-25T03:00Z', released: true })
    expect(f.last).toMatchObject({ done: false, release: true })
  })
})

describe('report text', () => {
  const text = formatReport(findings, { openCount: 15, today: TODAY, orderResult: order(snapshot), names: describeAll(snapshot) })

  it('passes the reply-style lint', () => {
    expect(lint(text)).toEqual([])
  })

  it('describes each issue the first time only, and keeps lines short', () => {
    expect(text).toContain('#11 (widget table and its route)')
    expect(text.match(/#11 \(/g)).toHaveLength(1)
    expect(text.split('\n').every((l) => l.length <= 160)).toBe(true)
    expect(text).toContain('In a cycle or waiting on one, left out: #13 #14')
  })

  it('wraps a long line at a comma', () => {
    const lines = wrap(`- ${'word, '.repeat(40)}end`, 60)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.slice(1).every((l) => /^ {2}\S/.test(l))).toBe(true)
  })
})

describe('fetchSnapshot', () => {
  it('uses only gh search queries and builds the markers', () => {
    const calls = []
    const run = (args) => {
      calls.push(args)
      const q = args[args.indexOf('-f') + 1]
      if (q.includes('in:comments')) return `${JSON.stringify({ number: 15 })}\n`
      if (q.includes('is:pr')) return `${JSON.stringify({ number: 50, title: 't', body: 'b', pull_request: { merged_at: 'x' } })}\n`
      return `${JSON.stringify({ number: 1, state: 'open' })}\n`
    }
    const snap = fetchSnapshot({ repo: 'example/repo', run })
    expect(calls.every((a) => a[0] === 'api' && a[3] === 'search/issues')).toBe(true)
    expect(snap.pulls).toEqual([{ number: 50, title: 't', body: 'b', merged_at: 'x' }])
    expect(snap.markers).toEqual({ release: [15], claim: [15] })
  })
})

describe('allowed fixes stay narrow', () => {
  const base = (issues, comments = {}) => ({ repo: 'example/repo', issues, pulls: [], markers: {}, comments })
  const issue = (number, title, extra = {}) => ({ number, title, state: 'open', labels: [{ name: 'task' }], body: '', updated_at: TODAY, ...extra })

  it('never proposes the reverse of "Do not start before #n"', () => {
    const snap = base([issue(1, 'E9 task A1: one', { body: 'Depends on: #2.\nDo not start this before #2 is merged.' }), issue(2, 'E9 task A2: two')])
    expect(analyze(snap, { today: TODAY }).filter((f) => f.kind === 'missing-dependency')).toEqual([])
  })

  it('leaves a same-title pair to the dispatcher when the newer one has a HANDOFF or another epic', () => {
    const handoff = { 2: [{ created_at: TODAY, author_association: 'OWNER', body: 'HANDOFF A1 - partial\nRELEASE' }] }
    const withHandoff = analyze(base([issue(1, 'Same work'), issue(2, 'Same work')], handoff), { today: TODAY })
    expect(withHandoff.find((f) => f.kind === 'duplicate').act).toBe('dispatcher')
    const twoEpics = analyze(base([issue(1, 'Same work', { parent: 7 }), issue(2, 'Same work', { parent: 8 })]), { today: TODAY })
    expect(twoEpics.find((f) => f.kind === 'duplicate').act).toBe('dispatcher')
    const noParent = analyze(base([issue(1, 'Same work'), issue(2, 'Same work')], { 2: [] }), { today: TODAY })
    expect(noParent.find((f) => f.kind === 'duplicate').act).toBe('dispatcher')
  })

  it('allows a same-title close only when the newer one has loaded comments, no claim marker and no PR', () => {
    const pair = [issue(1, 'Same work', { parent: 7 }), issue(2, 'Same work', { parent: 7 })]
    const act = (snap) => analyze(snap, { today: TODAY }).find((f) => f.kind === 'duplicate').act
    expect(act(base(pair, { 2: [] }))).toBe('allowed')
    expect(act(base(pair))).toBe('dispatcher')
    expect(act({ ...base(pair, { 2: [] }), markers: { claim: [2] } })).toBe('dispatcher')
    expect(act({ ...base(pair, { 2: [] }), pulls: [{ number: 9, title: 'x', body: 'Closes #2' }] })).toBe('dispatcher')
  })
})
