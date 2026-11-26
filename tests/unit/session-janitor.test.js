// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { lint, HEADINGS } from '../../scripts/reply-lint.mjs'
import { spawnSync } from 'node:child_process'
import { analyzeSessions, claimOf, describeSnapshot, formatSummary, inScope, KINDS, passOneFindings, splitSummary, summaryCounts, needs, normalizeSession, quote, SESSION_FIELDS, titleIssue, validateSessions } from '../../scripts/session-janitor.mjs'

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/session-janitor/${name}`, import.meta.url), 'utf8'))
const sessions = load('sessions.json')
const snapshot = load('snapshot.json')
const comments = load('comments.json')
const pulls = load('pulls.json')
const findings = analyzeSessions(sessions, snapshot, { comments, pulls })
const of = (kind) => findings.filter((f) => f.kind === kind)
const owner = (t, body) => ({ created_at: t, author_association: 'OWNER', body })
const run = (doc = sessions, extra = {}, opts = {}) => analyzeSessions(doc, snapshot, { comments: { ...comments, ...extra }, pulls, ...opts })
const only = (ids) => ({ ...sessions, sessions: sessions.sessions.filter((s) => ids.includes(s.id)) })
const edit = (id, change) => ({ ...sessions, sessions: sessions.sessions.map((s) => (s.id === id ? { ...s, ...change } : s)) })

describe('the sessions.json shape', () => {
  it('the fixture is valid, and the schema requires exactly the fields the script checks', () => {
    expect(validateSessions(sessions)).toEqual([])
    const schema = JSON.parse(readFileSync(new URL('../../.claude/skills/task-janitor/sessions.schema.json', import.meta.url), 'utf8'))
    expect(schema.properties.sessions.items.required).toEqual(SESSION_FIELDS)
    expect(schema.required).toEqual(['read_at', 'source', 'pages', 'has_more', 'sessions'])
  })

  it('refuses a dump with pages left, a missing field or a repeated id', () => {
    expect(validateSessions({ ...sessions, has_more: true })[0]).toContain('has_more must be false')
    const [first, ...rest] = sessions.sessions
    const noModel = { ...first }
    delete noModel.model
    expect(validateSessions({ ...sessions, sessions: [noModel, ...rest] })).toEqual(['sessions[0]: missing model'])
    expect(validateSessions({ ...sessions, sessions: [first, first] })).toEqual([`sessions[1]: ${first.id} is listed twice`])
  })

  it('reads a raw list_sessions row as well as the dump shape', () => {
    const raw = normalizeSession({ id: 'session_x', session_status: 'SESSION_STATUS_IDLE', status_bucket: 'SESSION_STATUS_BUCKET_REVIEW_READY', parent_session_id: 'session_p' })
    expect(raw).toMatchObject({ status: 'idle', bucket: 'review_ready', parent: 'session_p' })
  })
})

describe('every finding kind has a fixture', () => {
  for (const [kind] of KINDS) {
    it(kind, () => expect(of(kind).length).toBeGreaterThan(0))
  }
})

describe('findings on the fixture sessions', () => {
  it('allows a close only for a done HANDOFF with RELEASE and a merged PR', () => {
    const [handoff, merged] = of('done-open')
    expect(handoff).toMatchObject({ issue: 101, act: 'allowed', sessions: ['session_done'] })
    expect(handoff.evidence).toContain('matched by title and claim')
    expect(merged).toMatchObject({ issue: 102, act: 'dispatcher' })
  })

  it('asks for a HANDOFF, resumes a failed session and quotes what a stuck session asks', () => {
    expect(of('no-handoff')[0]).toMatchObject({ issue: 103, sessions: ['session_nohand'] })
    const [failed, asks] = of('stuck')
    expect(failed.action).toContain('continue from your last step')
    expect(failed.evidence).toContain("npm ci failed / disk full")
    expect(asks.evidence).toContain('pick the search ranking')
  })

  it('never prints a token from a session summary', () => {
    expect(JSON.stringify(findings)).not.toContain('ghp_')
    expect(quote('Bearer abc.def and sk-0123456789abcdef0123')).toBe('[redacted] and [redacted]')
  })

  it('nudges a review-ready session with an open PR, and flags red checks and Codex threads', () => {
    const [red, unread] = of('nudge-merge')
    expect(red).toMatchObject({ issue: 106 })
    expect(red.evidence).toContain('checks `red`, 1 open Codex thread')
    expect(unread.evidence).toContain('checks not read')
    const young = analyzeSessions(sessions, snapshot, { comments, pulls, reviewHours: 200 })
    expect(young.filter((f) => f.kind === 'nudge-merge')).toEqual([])
  })

  it('checks only pipeline sessions and their dispatcher', () => {
    expect(findings.some((f) => f.sessions.includes('session_other'))).toBe(false)
    expect(inScope({ tags: ['epic-273'] })).toBe(true)
    expect(inScope({ tags: ['epic-x', 'cowork-remote'] })).toBe(false)
    expect(validateSessions({ ...sessions, read_total: 2 })[0]).toContain('read_total')
  })

  it('finds an untagged session named by a CLAIM in the dump, and never calls a missing one gone without a check', () => {
    const claimed = run(sessions, { 109: [owner('1', 'CLAIM session session_other | branch b')] })
    expect(claimed.some((f) => f.kind === 'orphan-claim' && f.issue === 109)).toBe(true)
    expect(claimed.find((f) => f.issue === 109 && f.kind === 'orphan-claim').evidence).toContain('`failed`')
    const live = run(edit('session_other', { status_bucket: 'working' }), { 109: [owner('1', 'CLAIM session session_other | branch b')] })
    expect(live.some((f) => f.kind === 'orphan-claim' && f.issue === 109)).toBe(false)
    expect(of('orphan-claim')[0].evidence).toContain('check it with `get_session` before a release')
  })

  it('leaves the dispatcher out and finds the orphan session and the orphan claim', () => {
    expect(findings.some((f) => f.sessions.includes('session_disp'))).toBe(false)
    expect(of('orphan-session').map((f) => f.sessions[0])).toEqual(['session_orphan'])
    expect(of('orphan-claim')[0]).toMatchObject({ issue: 107, sessions: ['session_gone'] })
  })

  it('keeps the session of the live CLAIM among duplicates', () => {
    const [dup] = of('duplicate-session')
    expect(dup).toMatchObject({ issue: 108, sessions: ['session_dupa', 'session_dupb'] })
    expect(dup.action).toContain('keep `session_dupa`')
  })

  it('reuses pass 1 for duplicate issues, and gives a pair with a session to the dispatcher', () => {
    const [dup] = of('duplicate-issue')
    expect(dup).toMatchObject({ issue: 110, act: 'dispatcher', sessions: ['session_print'] })
    const quiet = { ...sessions, sessions: sessions.sessions.filter((s) => s.id !== 'session_print') }
    expect(analyzeSessions(quiet, snapshot, { comments, pulls }).find((f) => f.kind === 'duplicate-issue').act).toBe('allowed')
  })

  it('never proposes to archive a session that is not completed', () => {
    for (const f of of('stale')) {
      const s = sessions.sessions.find((x) => x.id === f.sessions[0])
      expect(f.action.startsWith('Can be archived')).toBe(s.status_bucket === 'completed')
    }
  })

  it('gives the same findings for the same input', () => {
    expect(analyzeSessions(sessions, snapshot, { comments, pulls })).toEqual(findings)
  })
})

describe('parsers', () => {
  it('reads the issue number of a title', () => {
    expect(titleIssue('273 #493: janitor pass 2')).toBe(493)
    expect(titleIssue('Explore the editor')).toBeNull()
  })

  it('reads the last CLAIM and its RELEASE', () => {
    const at = (t, body, author_association = 'OWNER') => ({ created_at: t, body, author_association })
    expect(claimOf([at('2', 'RELEASE'), at('1', 'CLAIM session session_a | branch b')])).toEqual({ session: 'session_a', at: '1', released: true })
    expect(claimOf([at('1', 'CLAIM session session_a'), at('2', 'CLAIM session session_b')]).session).toBe('session_b')
    expect(claimOf([at('1', 'CLAIM session session_a'), at('2', 'RELEASE', 'NONE')]).released).toBe(false)
    expect(claimOf([at('1', 'CLAIM session session_a', 'NONE')])).toBeNull()
  })

  it('matches a session named in a HANDOFF', () => {
    const doc = { ...sessions, sessions: [{ ...sessions.sessions[1], id: 'session_named', title: 'no number' }] }
    const extra = { 103: [{ created_at: '1', author_association: 'OWNER', body: 'HANDOFF A3 - partial\nSession: session_named\nRELEASE' }] }
    const result = analyzeSessions(doc, snapshot, { comments: { ...comments, ...extra } })
    expect(result.some((f) => f.kind === 'orphan-session')).toBe(false)
  })

  it('lists the comments and PR checks still needed, without the dispatcher', () => {
    expect(needs(sessions, snapshot, comments)).toEqual({ issues: [], prs: [206, 212] })
    expect(needs(sessions, snapshot).issues).toEqual([101, 102, 103, 104, 105, 106, 107, 108, 110, 112])
  })
})

describe('edge cases from the review', () => {

  it('gives a done HANDOFF to the dispatcher when a newer CLAIM is live, or its PR is not merged', () => {
    const reopened = run(sessions, { 101: [...comments[101], owner('2026-11-26T11:00:00Z', 'CLAIM session session_new | branch b')] })
    expect(reopened.find((f) => f.issue === 101 && f.kind === 'done-open')).toMatchObject({ act: 'dispatcher' })
    expect(reopened.find((f) => f.issue === 101).evidence).toContain('a newer CLAIM has no RELEASE')
    const unmerged = run(sessions, { 101: [owner('1', 'HANDOFF A1 - done\nPR: #299\nRELEASE')] })
    expect(unmerged.find((f) => f.issue === 101)).toMatchObject({ act: 'dispatcher' })
    expect(unmerged.find((f) => f.issue === 101).evidence).toContain('not in the merged list')
  })

  it('ignores a CLAIM or HANDOFF from an untrusted author', () => {
    const fake = { created_at: '1', author_association: 'NONE', user: 'stranger', body: 'CLAIM session session_orphan | branch x' }
    const result = run(sessions, { 103: [fake] })
    expect(result.some((f) => f.kind === 'orphan-session' && f.sessions[0] === 'session_orphan')).toBe(true)
    expect(result.some((f) => f.kind === 'duplicate-session' && f.issue === 103)).toBe(false)
  })

  it('rejects a dump with an invalid date, and never prints NaN', () => {
    expect(validateSessions(edit('session_old', { updated_at: null }))).toEqual(['sessions[11]: updated_at must be an ISO time'])
    expect(validateSessions(edit('session_old', { title: 7 }))).toEqual(['sessions[11]: title must be a string'])
    expect(JSON.stringify(run(edit('session_review', { updated_at: 'soon' })))).not.toContain('NaN')
    expect(() => run(sessions, {}, { today: 'later' })).toThrow('not an ISO time')
  })

  it('leaves the dispatcher out of duplicate issues and claims', () => {
    const doc = edit('session_disp', { title: 'Dispatcher #109' })
    expect(run(doc).some((f) => f.sessions.includes('session_disp'))).toBe(false)
    const claimed = run(sessions, { 104: [owner('1', 'CLAIM session session_disp | branch b')] })
    expect(claimed.some((f) => f.kind === 'orphan-claim' && f.issue === 104)).toBe(false)
  })

  it('asks to load comments before asking a session for its HANDOFF', () => {
    const result = analyzeSessions(only(['session_nohand']), snapshot, {})
    expect(result.find((f) => f.kind === 'no-handoff').action).toContain('Load its comments first')
  })

  it('does not call a claimed session gone when the dump holds only one dispatcher\'s children', () => {
    expect(run({ ...sessions, source: 'list_sessions children=true' }).some((f) => f.kind === 'orphan-claim')).toBe(false)
  })

  it('reads a disconnected worker as stuck, and a session on two issues once per issue', () => {
    const gone = run(edit('session_orphan', { connection_status: 'disconnected' }))
    expect(gone.find((f) => f.kind === 'stuck' && f.sessions[0] === 'session_orphan').evidence).toContain('disconnected')
    const two = run(edit('session_nohand', {}), { 104: [owner('1', 'CLAIM session session_nohand | branch b')] })
    expect(two.filter((f) => f.kind === 'no-handoff' && f.sessions[0] === 'session_nohand').map((f) => f.issue)).toEqual([103, 104])
  })

  it('does not propose to archive a completed session that another finding names', () => {
    const old = edit('session_nohand', { updated_at: '2026-11-10T00:00:00Z' })
    expect(run(old).find((f) => f.kind === 'stale' && f.sessions[0] === 'session_nohand').action).toContain('Not yet')
    // The session a duplicate finding keeps is never "can be archived" in the same report.
    const keep = edit('session_dupa', { status_bucket: 'completed', updated_at: '2026-11-10T00:00:00Z' })
    const kept = run(keep, { 108: [...comments[108], owner('2026-11-26T09:30:00Z', 'HANDOFF A8 - partial\nRELEASE'), owner('2026-11-26T09:40:00Z', 'CLAIM session session_dupa | branch b')] })
    expect(kept.find((f) => f.kind === 'stale' && f.sessions[0] === 'session_dupa').action).toContain('Not yet')
    const dup = edit('session_dupb', { status_bucket: 'completed', updated_at: '2026-11-10T00:00:00Z' })
    // session_dupb also has a no-handoff finding on #108, so it is held back; the duplicate-session finding alone would not.
    expect(run(dup).find((f) => f.kind === 'stale' && f.sessions[0] === 'session_dupb').action).toContain('Not yet')
  })

  it('keeps session ids and paths in quoted text, and masks keys and URL passwords', () => {
    expect(quote('see session_01UU4t2FpQfySF3P8nhraSTD in tests/unit/fixtures/session-janitor/sessions.json')).toBe('see session_01UU4t2FpQfySF3P8nhraSTD in tests/unit/fixtures/session-janitor/sessions.json')
    expect(quote('secret wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY1 end')).toBe('secret [redacted] end')
    expect(quote('src/components/editor/ThreadComposerToolbar')).toBe('src/components/editor/ThreadComposerToolbar')
    expect(quote('allow mcp__claude-code-remote__fire_trigger here')).toBe('allow mcp__claude-code-remote__fire_trigger here')
    expect(quote('dd 0123456789abcdef0123456789abcdef and 0123456789ABCDEF0123456789ABCDEF01234567')).toBe('dd [redacted] and [redacted]')
    expect(quote('key AKIAABCDEFGHIJKLMNOP at https://me:hunter2@db.example')).toBe('key [redacted] at https://[redacted]@db.example')
  })

  it('the command exits 1 on a dump with pages left and 2 on bad usage', () => {
    const cli = (...args) => spawnSync(process.execPath, ['scripts/session-janitor.mjs', ...args], { encoding: 'utf8', cwd: new URL('../..', import.meta.url).pathname })
    const dir = 'tests/unit/fixtures/session-janitor'
    expect(cli('findings').status).toBe(2)
    expect(cli('findings', `${dir}/sessions.json`, `${dir}/snapshot.json`, '--stale-days', 'x').status).toBe(2)
    const ok = cli('findings', `${dir}/sessions.json`, `${dir}/snapshot.json`, '--comments', `${dir}/comments.json`, '--pulls', `${dir}/pulls.json`)
    expect(JSON.parse(ok.stdout)).toEqual(findings)
    expect(cli('need', `${dir}/sessions-more.json`, `${dir}/snapshot.json`).status).toBe(1)
  })
})

describe('the templated summary', () => {
  const counts = summaryCounts(sessions, snapshot)
  const options = { counts, today: sessions.read_at, repo: snapshot.repo, names: describeSnapshot(snapshot), applied: load('applied.json') }
  const text = formatSummary(findings, options)

  it('matches the golden file exactly', () => {
    expect(text).toBe(readFileSync(new URL('./fixtures/session-janitor/summary.golden.md', import.meta.url), 'utf8'))
  })

  it('passes the reply-style lint, with findings, with none, and with an owner finding', () => {
    expect(lint(text, { template: true })).toEqual([])
    expect(lint(formatSummary([], { ...options, applied: [] }), { template: true })).toEqual([])
    const owner = [{ kind: 'stuck', sessions: ['session_x'], issue: 105, evidence: 'session `blocked`, it asks a money question.', action: 'Answer the question on {#105}.', act: 'owner' }]
    const withOwner = formatSummary(owner, options)
    expect(lint(withOwner, { template: true })).toEqual([])
    expect(withOwner).toContain('You need to do 1 thing (below).')
  })

  it('passes the lint for a title naming an unknown number and for titles with a pipe', () => {
    const doc = edit('session_orphan', { title: 'Look at #999 ideas' })
    const snap = { ...snapshot, issues: snapshot.issues.map((i) => (i.number === 109 || i.number === 110 ? { ...i, title: 'E100 task A9: print | view' } : i)) }
    const result = analyzeSessions(doc, snap, { comments, pulls })
    const text = formatSummary(result, { ...options, names: describeSnapshot(snap), applied: [{ issue: 101, what: 'closed | checked' }] })
    expect(lint(text, { template: true })).toEqual([])
    expect(text).toContain('#999 (not in the issue list)')
    expect(text.split('\n').filter((l) => l.startsWith('| ') && l.includes('`session_')).every((l) => l.split(' | ').length === 5)).toBe(true)
  })

  it('counts pass 1 owner and dispatcher findings in the combined summary', () => {
    const pass1Findings = [
      { kind: 'labels', issues: [105], what: '{#105}: the body says `held` and names an owner question.', fix: 'Ask the owner on {#105}.', act: 'owner' },
      { kind: 'stale', issues: [104], what: '{#104}: no activity for 20 days.', fix: 'Check it is still wanted.', act: 'dispatcher' }
    ]
    const text = formatSummary([], { ...options, applied: [], pass1Findings })
    expect(lint(text, { template: true })).toEqual([])
    expect(text).toContain('You need to do 1 thing (below).')
    expect(text).toContain('acts on the 1 `dispatcher` finding below')
    expect(text).toContain('| Pass 1 findings (issues, under Details) | 2 |')
    expect(text).toContain('0 findings and 2 from pass 1, 0 fixes applied (checked).')
  })

  it('leaves pass 1 duplicate pairs to the pass 2 finding, which keeps a pair with a session for the dispatcher', () => {
    const one = passOneFindings(snapshot, comments)
    expect(one.some((f) => f.kind === 'duplicate')).toBe(false)
    expect(findings.find((f) => f.kind === 'duplicate-issue').act).toBe('dispatcher')
  })

  it('links the session and the issue on every finding row', () => {
    const rows = text.split('\n').filter((l) => l.startsWith('| ') && l.includes('`session_'))
    expect(rows.length).toBe(findings.length)
    for (const row of rows) expect(row).toMatch(/\]\(https:\/\/claude\.ai\/code\/session_\w+\)/)
    expect(rows.filter((r) => !r.includes('| none |')).every((r) => /\]\(https:\/\/github\.com\/example\/repo\/issues\/\d+\)/.test(r))).toBe(true)
  })

  it('splits a summary over the comment limit into parts that each pass the lint', () => {
    expect(splitSummary(findings, options)).toEqual([text])
    const max = 3000
    const parts = splitSummary(findings, { ...options, pass1: 'Task janitor report.\n' }, max)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.every((p) => p.length <= max)).toBe(true)
    expect(lint(parts[0], { template: true })).toEqual([])
    for (const p of parts.slice(1)) expect(lint(p)).toEqual([])
    const rows = parts.join('\n').split('\n').filter((l) => l.startsWith('| ') && l.includes('`session_'))
    expect(rows.length).toBe(findings.length)
    expect(parts[0]).not.toContain('### Pass 1 report')
    expect(parts[0]).toContain('in the next comments (continued parts)')
    expect(parts.at(-1)).toContain(`part ${parts.length} of ${parts.length}`)
  })

  it('pads a short PR title with "pull request"', () => {
    expect(describeSnapshot(snapshot).get(201)).toBe('Export button pull request')
    const snap = { ...snapshot, pulls: [{ number: 301, title: 'Fix login issue now', body: '' }] }
    expect(describeSnapshot(snap).get(301)).toBe('Fix login issue now')
  })

  it('puts the counts first, with every kind', () => {
    const top = text.split('## TL;DR')[0]
    expect(top).toContain('14 sessions read in 1 page, 13 in scope,')
    for (const [kind] of KINDS) expect(top).toContain(`\`${kind}\``)
  })

  it('follows the template headings in order', () => {
    const template = readFileSync(new URL('../../.claude/reply-style-templates/janitor-summary.md', import.meta.url), 'utf8')
    const order = (t) => [...t.matchAll(/^## (.+)$/gm)].map((m) => m[1])
    expect(order(template)).toEqual([...HEADINGS, 'Details'])
    expect(order(text)).toEqual(order(template))
  })
})

describe('first real run fixes', () => {
  it('lists an old completed session with no issue once, as stale that can be archived', () => {
    const old = edit('session_orphan', { status_bucket: 'completed', updated_at: '2026-11-10T00:00:00Z' })
    const result = run(old).filter((f) => f.sessions.includes('session_orphan'))
    expect(result.map((f) => f.kind)).toEqual(['stale'])
    expect(result[0].evidence).toContain('no issue matches it')
    expect(result[0].action).toContain('Can be archived')
  })
})
