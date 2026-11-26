// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { analyzeSessions, claimOf, KINDS, needs, normalizeSession, quote, SESSION_FIELDS, titleIssue, validateSessions } from '../../scripts/session-janitor.mjs'

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/session-janitor/${name}`, import.meta.url), 'utf8'))
const sessions = load('sessions.json')
const snapshot = load('snapshot.json')
const comments = load('comments.json')
const pulls = load('pulls.json')
const findings = analyzeSessions(sessions, snapshot, { comments, pulls })
const of = (kind) => findings.filter((f) => f.kind === kind)

describe('the sessions.json shape', () => {
  it('the fixture is valid, and the schema requires exactly the fields the script checks', () => {
    expect(validateSessions(sessions)).toEqual([])
    const schema = JSON.parse(readFileSync(new URL('../../.claude/skills/task-janitor/sessions.schema.json', import.meta.url), 'utf8'))
    expect(schema.properties.sessions.items.required).toEqual(SESSION_FIELDS)
    expect(schema.required).toEqual(['read_at', 'pages', 'has_more', 'sessions'])
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
    const at = (t, body) => ({ created_at: t, body })
    expect(claimOf([at('2', 'RELEASE'), at('1', 'CLAIM session session_a | branch b')])).toEqual({ session: 'session_a', at: '1', released: true })
    expect(claimOf([at('1', 'CLAIM session session_a'), at('2', 'CLAIM session session_b')]).session).toBe('session_b')
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
