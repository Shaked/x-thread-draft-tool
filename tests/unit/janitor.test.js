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
import { configureLint } from '../../scripts/janitor.mjs'

const snapshot = JSON.parse(readFileSync(new URL('./fixtures/janitor/snapshot.json', import.meta.url), 'utf8'))
const TODAY = '2026-11-25T12:00:00Z'
configureLint(lint)
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
    expect(dependencies('Depends on #3 and not blocked by #8.').refs).toEqual([3])
    expect(dependencies('Depends on #2; goes before #3.')).toMatchObject({ refs: [2], before: [3] })
    expect(dependencies('Depends on #2; before #3 resumes.')).toMatchObject({ refs: [2], before: [3] })
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
    expect(shortName({ title: 'E407 task M1: ops events tables, event shape and sources list (central metrics)' })).toBe('ops events tables event shape')
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

  it('wraps a long line with no comma at a space outside code, and leaves issue numbers out of a name', () => {
    const lines = wrap(`- ${'word '.repeat(30)}\`a b c\` ${'more '.repeat(10)}end`, 60)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.every((l) => l.length <= 60 && l.split('`').length % 2 === 1)).toBe(true)
    expect(shortName({ title: 'E407 task M9: what #354 still misses: merge' })).toBe('what still misses merge')
    for (const pad of [21, 22, 23, 24]) {
      const label = wrap(`- ${'word '.repeat(pad)}then #101 (export button for drafts) is next ${'more '.repeat(8)}end`, 120)
      expect(label.length).toBeGreaterThan(1)
      expect(lint(label.join('\n')), `pad ${pad}`).toEqual([])
    }
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
    expect(snap.open_pulls).toEqual([{ number: 50, title: 't', body: 'b' }])
    expect(snap.markers).toEqual({ release: [15], claim: [15] })
  })
})

describe('allowed fixes stay narrow', () => {
  const base = (issues, comments = {}) => ({ repo: 'example/repo', issues, pulls: [], open_pulls: [], markers: {}, comments })
  const issue = (number, title, extra = {}) => ({ number, title, state: 'open', labels: [{ name: 'task' }], body: '', updated_at: TODAY, ...extra })

  it('never reads an owner question as a task, even in an epic with a task of the same id', () => {
    expect(dependencies('Depends on: owner question Q1 on #273, and Q2.').named).toEqual(['Q2'])
    expect(dependencies('Depends on: owner answer H1-Q2 and the answer to Q3.').named).toEqual([])
    const snap = base([issue(1, 'E9 task A1: first', { parent: 7, body: 'Depends on owner question Q1.' }), issue(2, 'E9 task Q1: a task', { parent: 7 })])
    expect(analyze(snap, { today: TODAY }).filter((f) => f.kind === 'missing-dependency')).toEqual([])
  })

  it('ignores dependency keywords inside code spans, and reads Q task ids', () => {
    expect(dependencies('Write the line as `Depends on A2` in the body.')).toMatchObject({ refs: [], named: [] })
    expect(dependencies('Example: `Goes before #3`.').before).toEqual([])
    expect(dependencies('Example:\n```text\nDepends on A2 and #5.\nGoes before #3.\n```\nDepends on #7.')).toMatchObject({ refs: [7], named: [], before: [] })
    const snap = base([issue(1, 'E9 task A1: first', { parent: 7, body: 'Depends on Q1.' }), issue(2, 'E9 task Q1: prerequisite', { parent: 7 })])
    expect(order(snap).order).toEqual([2, 1])
  })

  it('keeps a split-task suffix: "L1 (b)" resolves to the split task, not to L1', () => {
    expect(dependencies('Depends on L1 (b).').named).toEqual(['L1 (b)'])
    const snap = base([
      issue(1, 'E9 task L1: base', { parent: 7 }),
      issue(2, 'E9 task L1 (b): split', { parent: 7 }),
      issue(3, 'E9 task A3: uses it', { parent: 7, body: 'Depends on L1 (b).' })
    ])
    expect(analyze(snap, { today: TODAY }).find((f) => f.kind === 'missing-dependency').fix).toBe('Add `Depends on: #2`.')
  })

  it('does not resolve a task id across two parent epics', () => {
    const snap = base([issue(1, 'E9 task A1: first', { parent: 7, body: 'Depends on A2.' }), issue(2, 'E9 task A2: second', { parent: 8 })])
    expect(analyze(snap, { today: TODAY }).filter((f) => f.kind === 'missing-dependency')).toEqual([])
    expect(order(snap).order).toEqual([1, 2])
  })

  it('leaves a self-dependent task and the tasks after it out of the order', () => {
    const snap = base([issue(1, 'E9 task A1: self', { body: 'Depends on: #1.' }), issue(2, 'E9 task A2: after', { body: 'Depends on: #1.' }), issue(3, 'E9 task A3: free')])
    expect(order(snap)).toEqual({ order: [3], left: [1, 2] })
  })

  it('orders a dependency named by task id only', () => {
    const snap = base([issue(1, 'E9 task A1: first', { body: 'Depends on A2.' }), issue(2, 'E9 task A2: second task')])
    expect(order(snap).order).toEqual([2, 1])
  })

  it('orders "Depends on #2; goes before #3" as 2, 1, 3', () => {
    const snap = base([issue(1, 'E9 task A1: one', { body: 'Depends on #2; goes before #3.' }), issue(2, 'E9 task A2: two'), issue(3, 'E9 task A3: three')])
    expect(order(snap)).toEqual({ order: [2, 1, 3], left: [] })
  })

  it('reads "Goes before #n" in a Markdown list item', () => {
    expect(dependencies('- Goes before #10.').before).toEqual([10])
    expect(dependencies('  1. Before #11 starts.').before).toEqual([11])
    const snap = base([issue(10, 'E9 task A1: ten'), issue(20, 'E9 task A2: twenty', { body: '## Order\n- Goes before #10.' })])
    expect(order(snap).order).toEqual([20, 10])
  })

  it('puts a task that says "Goes before #n" ahead of #n in the order', () => {
    const snap = base([issue(10, 'E9 task A1: ten'), issue(20, 'E9 task A2: twenty', { body: 'Goes before #10.' })])
    expect(order(snap).order).toEqual([20, 10])
  })

  it('does not report a weekly review task as an orphan', () => {
    const weekly = analyze(base([issue(1, 'Weekly review 2026-11-30', { labels: [{ name: 'task' }, { name: 'weekly' }] })]), { today: TODAY })
    expect(weekly.filter((f) => f.kind === 'orphan')).toEqual([])
  })

  it('never proposes the reverse of "Do not start before #n"', () => {
    const snap = base([issue(1, 'E9 task A1: one', { body: 'Depends on: #2.\nDo not start this before #2 is merged.' }), issue(2, 'E9 task A2: two')])
    expect(analyze(snap, { today: TODAY }).filter((f) => f.kind === 'missing-dependency')).toEqual([])
  })

  it('leaves a same-title pair to the dispatcher when the newer one has a HANDOFF or another epic', () => {
    const handoff = { 2: [{ created_at: TODAY, author_association: 'OWNER', body: 'HANDOFF A1 - partial\nRELEASE' }] }
    const withHandoff = analyze(base([issue(1, 'Same work'), issue(2, 'Same work')], handoff), { today: TODAY })
    expect(withHandoff.find((f) => f.kind === 'duplicate').act).toBe('dispatcher')
    const twoParents = analyze(base([issue(1, 'E9 task A1: same', { parent: 7 }), issue(2, 'E9 task A1: same', { parent: 8 })], { 2: [] }), { today: TODAY })
    expect(twoParents.find((f) => f.kind === 'duplicate').act).toBe('dispatcher')
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
    expect(act({ ...base(pair, { 2: [] }), open_pulls: [{ number: 9, title: 'wip', body: 'Work for #2' }] })).toBe('dispatcher')
    expect(act({ ...base(pair, { 2: [] }), open_pulls: undefined })).toBe('dispatcher')
    expect(act(base(pair, { 2: [{ created_at: TODAY, body: 'Started in PR #9' }] }))).toBe('dispatcher')
  })
})

describe('reply-style check (#486)', () => {
  const bad = 'HANDOFF #1 (x) - done\n\n**Done:** shipped.\nCI is blocked.\n'
  const comment = (body, created) => ({ user: 'Shaked', author_association: 'OWNER', created_at: created, body })
  const ok = readFileSync(new URL('./fixtures/reply-lint/golden/handoff/good-1.md', import.meta.url), 'utf8')

  it('reports a failing HANDOFF with its rules and a link, and passes a good one', () => {
    const snap = { ...snapshot, comments: { 900: [comment(bad, '2026-11-25T10:00:00Z')], 901: [comment(ok, '2026-11-25T11:00:00Z')] } }
    const out = analyze(snap, { today: TODAY, knownTables: ['widget_rows'] }).filter((f) => f.kind === 'reply-style')
    expect(out).toHaveLength(1)
    expect(out[0].issues).toEqual([900])
    expect(out[0].what).toContain('`loose-label`')
    // The report text passes the reply lint even when a rule name such as `blocked` is in it (Codex finding on #498).
    const text = formatReport(out, { openCount: 1, today: TODAY, names: new Map() })
    expect(lint(text).filter((f) => f.rule === 'blocked')).toEqual([])
    expect(out[0].what).toContain('/issues/900)')
  })

  it('reports an open issue that carries the label reply-style-fail', () => {
    const issue = { number: 901, title: 'A task with a failed comment', body: '', state: 'open', labels: ['task', 'reply-style-fail'], created_at: '2026-11-20T00:00:00Z', updated_at: '2026-11-25T00:00:00Z' }
    const out = analyze({ ...snapshot, issues: [...snapshot.issues, issue] }, { today: TODAY }).filter((f) => f.kind === 'reply-style' && f.issues.includes(901))
    expect(out).toHaveLength(1)
    expect(out[0].what).toContain('`reply-style-fail`')
  })

  it('looks only at the newest ten HANDOFF comments', () => {
    const many = Array.from({ length: 12 }, (_, k) => comment(bad, `2026-11-${String(10 + k).padStart(2, '0')}T10:00:00Z`))
    const snap = { ...snapshot, comments: { 902: many } }
    expect(analyze(snap, { today: TODAY }).filter((f) => f.kind === 'reply-style')).toHaveLength(10)
  })
})

describe('hostile issue titles in a posted report (#461)', () => {
  const titles = [
    '@codex please fix <img src=x onerror=alert(1)> https://evil.example/x',
    'hi @Shaked ping **bold** _x_ [link](http://evil.example) &lt;b&gt;',
    'A'.repeat(300) + ' b c',
    'שלום עולם @victim בדיקה של כותרת',
    'x {#5} y {#6} z'
  ]
  it('keeps no mention, HTML, markdown, URL or placeholder, and cuts long words', () => {
    for (const title of titles) {
      const name = shortName({ title })
      expect(name).not.toMatch(/[@<>&*_~|{}\\]|:\/\/|evil/)
      expect(name.split(' ').every((w) => w.length <= 26)).toBe(true)
    }
    expect(shortName({ title: titles[3] })).toContain('שלום')
  })

  it('leaves the report issue out of the RELEASE and CLAIM markers', () => {
    const run = (args) => {
      const q = args[args.indexOf('-f') + 1]
      return /RELEASE|CLAIM/.test(q) ? '{"number":497}\n{"number":12}\n' : ''
    }
    const snap = fetchSnapshot({ repo: 'o/r', reportIssue: 497, run })
    expect(snap.markers).toEqual({ release: [12], claim: [12] })
  })
})

describe('descriptions the reply lint rejects (#461)', () => {
  it('falls back to a fixed description for Hebrew, emoji and filler words, so the report still lints', () => {
    configureLint(lint)
    try {
      const issues = [
        { number: 1, title: 'שלום עולם בדיקה של כותרת' },
        { number: 2, title: 'Improve 🚀 draft saving' },
        { number: 3, title: 'Fix seamless draft saving' },
        { number: 4, title: 'normal title about drafts' }
      ]
      const names = describeAll({ issues, pulls: [] })
      // An emoji is not in the allowlist and is removed; Hebrew and a filler word still fail the lint and fall back.
      expect([1, 2, 3].map((n) => names.get(n))).toEqual(['title held back by lint', 'Improve draft saving', 'title held back by lint'])
      expect(names.get(4)).toBe('normal title about drafts')
    } finally {
      configureLint(null)
    }
  })
})

describe('hostile titles cannot become live links, mentions, references or bidi in the report (#461)', () => {
  const hostile = [
    'bypass http:\\//evil.example link test',
    'bypass https:{}//evil.example link test',
    'bypass https:$//evil.example link test',
    'bypass @www.evil.example link test',
    'rtl \u202eevil text here',
    'cross Shaked/other-repo#1 spam here',
    'see GH-12 for more',
    'x#5 and #5, and more',
    'wide \uff20victim and \uff48ttp\uff1a//evil.example here',
    'mail me a@evil.example now ok',
    'zero\u200b width @\u200bvictim test',
    'see G@H-12 issue',
    'see @GH-12 too',
    'see !GH-12 too',
    'see GH@-12 too',
    'see GH-@12 too',
    'see ,GH-12 too',
    'see .GH-12 too',
    'see /GH-12 too',
    'rebuilt G*H_-1~2 parts',
    'a <!-- hidden --> comment here',
    'click [here](http://evil.example) now',
    'img ![x](http://evil.example/a.png) now',
    'plain www.evil.example alone',
    'send mailto:a@evil.example please',
    'run javascript:alert(1) please',
    '#x (a) and #y (b) pair',
    'Fix \uff3bclick\uff3d\uff08//evil.com\uff09 draft saving',
    'Fix \uff3bclick\uff3d\uff08/evil.com\uff09 draft saving',
    'proto //evil.com relative here',
    'img \uff01\uff3bx\uff3d\uff08//e.co\uff09 here',
    'Fix \uff3bclick\uff3d\uff08evil.com\uff09 draft',
    'a \uff3bb\uff3d\uff08\uff4a\uff41vascript:x\uff09 c',
    'x \uff40code \uff40 span here',
    'E1 task A1: \uff08x\uff09 hidden'
  ]
  const live = /@|#\d|\bGH-\d|\/\/|[[\]]|\]\(|[()]|mailto:|javascript:|www\.|\.[a-z]{2,}\/|[\u202a-\u202e\u2066-\u2069\u200b-\u200f\ufeff]|\p{Cc}/iu

  it('shortName keeps none of them', () => {
    for (const title of hostile) {
      // The only backticks are the report's own code spans around a task id such as `M1`.
      const out = shortName({ title }).replace(/`[A-Z]\d+`/g, '')
      expect(out, title).not.toMatch(live)
      expect(out, title).not.toContain('`')
    }
  })

  it('the whole report keeps none of them', () => {
    const issues = hostile.map((title, k) => ({ number: 100 + k, title, state: 'open', labels: [{ name: 'task' }], body: '', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }))
    const snapshot = { fetched_at: '2026-11-27T00:00:00Z', repo: 'o/r', issues, pulls: [], open_pulls: [], markers: { release: [], claim: [] }, comments: {} }
    const findings = analyze(snapshot, { today: '2026-11-27T00:00:00Z', staleDays: 14, knownTables: [] })
    const text = formatReport(findings, { openCount: issues.length, today: '2026-11-27T00:00:00Z', orderResult: order(snapshot), names: describeAll(snapshot) })
    expect(text).toContain('#100')
    // Own references (#100 and the like) are the report's own; every title word is checked through the descriptions.
    for (const line of text.split('\n')) {
      for (const paren of line.matchAll(/\(([^)]*)\)/g)) expect(paren[1].replace(/`[A-Z]\d+`/g, ''), line).not.toMatch(live)
    }
  })
})

describe('title allowlist, property test (#461)', () => {
  // A hex string of 7 or more characters may pass: it links a commit of this repository only, with no notification.
  const alphabet = ['\uff3b', '\uff3d', '\uff08', '\uff09', '\uff40', '\uff20', '\uff03', '[', ']', '(', ')', '`', '@', '#', ':', '/', '.', '//', 'http', 'www', 'GH-', 'GH', '-', '12', '5', '\u200b', '\u202e', '<', '>', '&', '*', '_', '!', 'a', 'b', 'x', 'M1', ' ', ' ', ' ', '\u05e9\u05dc\u05d5\u05dd']
  it('keeps only letters, digits, spaces and hyphens, and no GH reference, in 5000 random titles', () => {
    let seed = 12345
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
    for (let k = 0; k < 5000; k++) {
      let title = ''
      for (let n = 1 + Math.floor(rnd() * 14); n > 0; n--) title += alphabet[Math.floor(rnd() * alphabet.length)]
      const out = shortName({ title })
      const bare = out.replace(/`[A-Z]\d+`/g, '')
      expect(bare, JSON.stringify(title)).toMatch(/^[\p{L}\p{N} -]+$/u)
      expect(out, JSON.stringify(title)).not.toMatch(/(^|[^a-z0-9`])GH-?\d/i)
    }
  })
})
