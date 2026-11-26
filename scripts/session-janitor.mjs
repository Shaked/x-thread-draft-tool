#!/usr/bin/env node
// Janitor pass 2 (#493): matches Claude Code sessions with issues and finds what is done, stuck or orphaned.
// Node 20, no dependencies, no model, no network. It never writes anywhere. The agent dumps the sessions with the
// Claude Code Remote tools into sessions.json (shape: .claude/skills/task-janitor/sessions.schema.json) and reuses
// the pass 1 snapshot (`node scripts/janitor.mjs fetch`). Rules for acting on it: .claude/skills/task-janitor/SKILL.md.
//
//   node scripts/session-janitor.mjs need sessions.json snapshot.json [--comments comments.json]
//       Prints the issues whose comments are still needed, and the open PRs whose checks and threads are needed.
//   node scripts/session-janitor.mjs findings sessions.json snapshot.json [--comments f] [--pulls f] [--today ISO]
//       [--review-hours N] [--stale-days N]
//       Prints the findings as JSON, one object per finding.
//   node scripts/session-janitor.mjs report sessions.json snapshot.json [same options] [--applied applied.json]
//       [--pass1 pass1.txt]
//       Prints the summary in the template .claude/skills/reply-style/templates/janitor-summary.md.
//       applied.json lists the fixes the agent applied and checked: [{ "issue": n, "what": "closed as completed ..." }].
//
// analyzeSessions() is pure: the tests run it on fixtures.

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { analyze as passOne, commentFacts, describeAll, expand, normalize, REPO, shortName, TRUSTED } from './janitor.mjs'

export const REVIEW_HOURS = 2
export const STALE_DAYS = 3
// Every finding kind, in report order, with its table label. A test fails when a kind has no fixture.
export const KINDS = [
  ['done-open', 'Done, issue open'],
  ['no-handoff', 'Done, no HANDOFF'],
  ['stuck', 'Failed or needs input'],
  ['nudge-merge', 'Review-ready, PR open'],
  ['orphan-session', 'Orphan session'],
  ['orphan-claim', 'Orphan claim'],
  ['duplicate-session', 'Duplicate sessions'],
  ['duplicate-issue', 'Duplicate issues'],
  ['stale', 'Stale session']
]
// The fields of one session in sessions.json, as the schema requires them.
export const SESSION_FIELDS = ['id', 'title', 'status', 'status_bucket', 'post_turn_summary', 'updated_at', 'created_at', 'parent', 'tags', 'model']
const FINISHED = new Set(['completed', 'review_ready'])
// One session id pattern for titles, CLAIM and HANDOFF comments, and the dump.
const SESSION_ID = 'session_[A-Za-z0-9]+'
const validTime = (t) => typeof t === 'string' && !Number.isNaN(Date.parse(t))

/** "SESSION_STATUS_BUCKET_REVIEW_READY" and "review_ready" both give "review_ready". */
const word = (s) => String(s || '').replace(/^SESSION_STATUS_(?:BUCKET_)?/, '').toLowerCase()

/** One session in the shape the checks use. Accepts the sessions.json shape and a raw list_sessions row. */
export function normalizeSession(s) {
  const pts = s.post_turn_summary || {}
  return {
    id: s.id,
    title: s.title || '',
    status: word(s.status ?? s.session_status),
    bucket: word(s.status_bucket),
    needs: pts.needs_action || '',
    recent: pts.recent_action || '',
    category: pts.status_category || '',
    updatedAt: s.updated_at,
    createdAt: s.created_at,
    parent: s.parent ?? s.parent_session_id ?? null,
    tags: s.tags || [],
    model: s.model ?? null,
    connection: s.connection_status || null
  }
}

/** Errors in a sessions.json document; empty when it has the documented shape and every page was read. */
export function validateSessions(doc) {
  const errors = []
  if (!doc || typeof doc !== 'object') return ['sessions.json is not an object']
  if (typeof doc.read_at !== 'string' || Number.isNaN(Date.parse(doc.read_at))) errors.push('read_at must be an ISO time')
  if (!Number.isInteger(doc.pages) || doc.pages < 1) errors.push('pages must be the number of list_sessions pages read (1 or more)')
  if (typeof doc.source !== 'string' || !doc.source) errors.push('source must name the list_sessions call (mine=true or children=true)')
  if (doc.has_more !== false) errors.push('has_more must be false: read every page (after_id = last_id) before the report')
  if (!Array.isArray(doc.sessions)) return [...errors, 'sessions must be an array']
  if ('read_total' in doc && !(Number.isInteger(doc.read_total) && doc.read_total >= doc.sessions.length)) {
    errors.push('read_total must count every session read, at least the sessions listed')
  }
  const ids = new Set()
  doc.sessions.forEach((s, k) => {
    for (const f of SESSION_FIELDS) if (!(f in (s || {}))) errors.push(`sessions[${k}]: missing ${f}`)
    if (typeof s?.id !== 'string' || !new RegExp(`^${SESSION_ID}$`).test(s.id)) errors.push(`sessions[${k}]: id must look like session_...`)
    else if (ids.has(s.id)) errors.push(`sessions[${k}]: ${s.id} is listed twice`)
    else ids.add(s.id)
    if (s && 'title' in s && typeof s.title !== 'string') errors.push(`sessions[${k}]: title must be a string`)
    for (const f of ['updated_at', 'created_at']) if (s && f in s && !validTime(s[f])) errors.push(`sessions[${k}]: ${f} must be an ISO time`)
  })
  return errors
}

/** A session of this repo's pipeline: tagged `pipeline` or `epic-<n>`. Other sessions of the account are out of scope. */
export const inScope = (s) => (s.tags || []).some((t) => t === 'pipeline' || /^epic-\d+$/.test(t))

/** The sessions the checks look at: those in scope and the dispatchers that started them. */
export function scoped(sessions) {
  const kept = sessions.filter(inScope)
  const parents = new Set(kept.map((s) => s.parent).filter(Boolean))
  return sessions.filter((s) => inScope(s) || parents.has(s.id))
}

/** The issue number a session title names: the first "#NNN". */
export function titleIssue(title) {
  const m = /#(\d+)\b/.exec(title || '')
  return m ? Number(m[1]) : null
}

const TOKEN = /\b(?:gh[pousr]_\w{16,}|github_pat_\w{16,}|sk-[\w-]{16,}|xox[abprs]-[\w-]{10,}|AKIA[0-9A-Z]{16}|eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{4,})|\bBearer\s+\S+/g
// Any other run of 32 or more key characters is masked too, except a session id. Paths keep their slashes, so they stay.
const LONG = /\b[A-Za-z0-9+_-]{32,}/g
// A long run with a digit is masked (hex keys too); one with no digit, such as the tool name
// mcp__claude-code-remote__fire_trigger, stays. A base64 run with slashes is masked when it mixes digits and both cases.
const keyLike = (m) => /\d/.test(m) && /[a-z]/.test(m) && /[A-Z]/.test(m)
// A base64 secret may hold slashes: a run of 40 or more base64 characters with digits and both cases is masked as well.
const BASE64 = /[A-Za-z0-9+/]{40,}={0,2}/g

/** Text copied from a session for a table cell: one line, no backticks or pipes, tokens masked, at most `max` characters. */
export function quote(text, max = 100) {
  const one = String(text || '').replace(/\s+/g, ' ').replace(/`/g, "'").replace(/\|/g, '/').replace(TOKEN, '[redacted]')
    .replace(/:\/\/[^/\s:@]+:[^@\s]+@/g, '://[redacted]@').replace(LONG, (m) => (new RegExp(`^${SESSION_ID}$`).test(m) || /^[A-Za-z_-]+$/.test(m) ? m : '[redacted]')).replace(BASE64, (m) => (keyLike(m) ? '[redacted]' : m)).trim()
  return one.length > max ? `${one.slice(0, max - 3).trimEnd()}...` : one
}

/** Comments from the owner, a member or a collaborator, in time order: only these can claim, hand off or release. */
export function trusted(comments = [], owner = REPO.split('/')[0]) {
  return comments.filter((c) => TRUSTED.has(c.author_association) || c.user === owner)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
}

/** Live CLAIM per open issue: { session, at, released } from the last trusted CLAIM comment. */
export function claimOf(comments = [], owner) {
  let claim = null
  for (const c of trusted(comments, owner)) {
    const body = c.body || ''
    const first = body.split('\n')[0]
    if (/^CLAIM\b/.test(first)) {
      const m = new RegExp(`\\bsession\\s+(${SESSION_ID})`).exec(first)
      claim = { session: m ? m[1] : null, at: c.created_at, released: false }
    } else if (claim && /^RELEASE\s*$/m.test(body)) claim.released = true
  }
  return claim
}

// NaN when a time is missing or invalid: every time check below is then skipped.
const hours = (now, t) => (now - Date.parse(t)) / 3600000
const ref = (n) => `{#${n}}`
const code = (s) => `\`${s}\``

// Matches: session id -> Map(issue -> evidence words). Live CLAIM per issue.
function matchAll(c) {
  c.matches = new Map(c.sessions.map((s) => [s.id, new Map()]))
  const match = (id, n, how) => {
    if (!c.matches.has(id) || !c.byNum.has(n)) return
    const m = c.matches.get(id)
    m.set(n, [...new Set([...(m.get(n) || []), how])])
  }
  for (const s of c.sessions) {
    const n = titleIssue(s.title)
    if (n !== null) match(s.id, n, 'title')
  }
  c.claims = new Map()
  for (const i of c.issues) {
    const list = trusted(c.loaded(i.number) || [], c.owner)
    const claim = claimOf(list, c.owner)
    if (claim) c.claims.set(i.number, claim)
    for (const x of list) {
      const first = (x.body || '').split('\n')[0]
      if (/^CLAIM\b/.test(first)) for (const m of first.matchAll(new RegExp(`\\bsession\\s+(${SESSION_ID})`, 'g'))) match(m[1], i.number, 'claim')
      if (/^HANDOFF\b/.test(first)) for (const m of (x.body || '').matchAll(new RegExp(`\\b(${SESSION_ID})`, 'g'))) match(m[1], i.number, 'handoff')
    }
  }
}

const state = (s) => `session ${code(s.bucket || s.status)}`

/** Failed, disconnected or waiting for input. Returns true when the session is stuck. */
function checkStuck(c, s, issue) {
  if (s.bucket === 'failed' || (s.connection === 'disconnected' && s.bucket === 'working')) {
    const why = s.bucket === 'failed' ? 'its last turn failed' : 'its worker is disconnected'
    const model = s.model ? `; model ${code(s.model)}` : ''
    const last = s.recent ? `; last: ${code(quote(s.recent))}` : ''
    c.add('stuck', [s.id], issue, `${state(s)}: ${why}${model}${last}.`,
      'Resume: send "continue from your last step" once; failed twice, a new session with Sonnet on the same branch.')
    return true
  }
  if (s.bucket !== 'blocked' && s.category !== 'need_input') return false
  c.add('stuck', [s.id], issue, `${state(s)}${s.needs ? `, it asks: ${code(quote(s.needs))}` : ', no question in its summary'}.`,
    'Decide: read its last message and answer it; an owner-only matter goes to Shaked with the label `owner`.')
  return true
}

function checkOrphan(c, s) {
  const n = titleIssue(s.title)
  const named = n !== null ? `; its title names ${ref(n)}` : '; no issue number in its title, no CLAIM or HANDOFF names it'
  c.add('orphan-session', [s.id], null, `${state(s)}${named}.`, 'Read it: link it to its issue with a CLAIM, or archive it once it is completed.')
}

/** A finished session on an open issue: done (close it) or no HANDOFF (ask for it). */
function checkDone(c, s, n) {
  if (!FINISHED.has(s.bucket)) return
  const f = c.facts.get(n)
  const done = Boolean(f.last?.done && f.last.release)
  const prs = c.mergedNaming(n)
  const how = `matched by ${c.matches.get(s.id).get(n).join(' and ')}`
  if (done || prs.length) closeProposal(c, s, n, { f, done, prs, how })
  else if (!c.openNaming(n).length && !f.handoffs.length) {
    if (c.loaded(n)) c.add('no-handoff', [s.id], n, `${state(s)}; no HANDOFF comment; no open PR names it; ${how}.`, 'Ask the session to post its HANDOFF with RELEASE.')
    else c.add('no-handoff', [s.id], n, `${state(s)}; comments not loaded; no open PR names it; ${how}.`, 'Load its comments first (`need` lists them), then run the report again.')
  }
}

/** Done with the issue open: `allowed` only for a done HANDOFF with RELEASE, its PR merged, and no newer live CLAIM. */
function closeProposal(c, s, n, { f, done, prs, how }) {
  const prMerged = Boolean(done && f.last.pr && c.merged.has(f.last.pr))
  // A CLAIM after the done HANDOFF with no RELEASE means the work was picked up again: never an allowed close.
  const claim = c.claims.get(n)
  const reopened = Boolean(done && claim && !claim.released && String(claim.at) > String(f.last.at))
  const pr = done && f.last.pr ? `; PR ${ref(f.last.pr)} is ${prMerged ? 'merged' : 'not in the merged list'}` : ''
  const evidence = (done ? `${state(s)}; the last HANDOFF says done and has RELEASE${pr}` : `${state(s)}; merged PR ${prs.map(ref).join(', ')} names it; no done HANDOFF`)
    + (reopened ? '; a newer CLAIM has no RELEASE' : '')
  if (prMerged && !reopened) c.add('done-open', [s.id], n, `${evidence}; ${how}.`, `Close ${ref(n)} as completed after reading its HANDOFF.`, 'allowed')
  else c.add('done-open', [s.id], n, `${evidence}; ${how}.`, 'Read the PRs and the issue: close it, or write in the issue what is left.')
}

function prFlag(c, p) {
  const info = c.pulls[p] || c.pulls[String(p)]
  if (!info) return { text: `PR ${ref(p)}: checks not read`, red: false }
  const list = []
  if (info.checks && info.checks !== 'green') list.push(`checks ${code(info.checks)}`)
  if (info.codex_threads > 0) list.push(`${info.codex_threads} open Codex ${info.codex_threads > 1 ? 'threads' : 'thread'}`)
  return { text: `PR ${ref(p)}: ${list.length ? list.join(', ') : 'checks green, no open Codex thread'}`, red: list.length > 0 }
}

function checkReview(c, s, n) {
  const openPrs = c.openNaming(n)
  const age = hours(c.now, s.updatedAt)
  if (s.bucket !== 'review_ready' || !openPrs.length || !(age > c.reviewHours)) return
  const flags = openPrs.map((p) => prFlag(c, p))
  c.add('nudge-merge', [s.id], n, `${state(s)} for ${Math.floor(age)} hours; ${flags.map((x) => x.text).join('; ')}.`,
    flags.some((x) => x.red) ? 'Nudge it: fix the red checks and answer the Codex threads, then merge.' : 'Nudge it to merge once Opus has judged the final head.')
}

const isStale = (c, s) => s.bucket !== 'working' && hours(c.now, s.updatedAt) / 24 > c.staleDays

function checkStale(c, s, issue, named) {
  const days = hours(c.now, s.updatedAt) / 24
  if (!isStale(c, s)) return
  // A completed session that another finding names still has something to post: it is not archived yet.
  let action = 'Not completed, so never archive it: read why it stopped.'
  if (s.bucket === 'completed') action = named ? 'Not yet: another finding names it; archive it once that is done.' : 'Can be archived: it is completed.'
  const orphan = c.matches.get(s.id).size ? '' : '; no issue matches it'
  c.add('stale', [s.id], issue, `${state(s)}; no update for ${Math.floor(days)} days${orphan}.`, action)
}

function checkSession(c, s) {
  const found = [...c.matches.get(s.id).keys()].sort((a, b) => a - b)
  if (checkStuck(c, s, found[0] ?? null)) c.stuck.add(s.id)
  // A completed, stale session with no issue is listed once, as stale ("no issue matches it").
  if (!found.length && !(s.bucket === 'completed' && isStale(c, s))) checkOrphan(c, s)
  for (const n of found.filter((k) => c.byNum.get(k).state === 'open')) {
    checkDone(c, s, n)
    checkReview(c, s, n)
  }
}

// Two or more sessions (the dispatcher left out) match one open issue.
function checkDuplicateSessions(c, workers) {
  const perIssue = new Map()
  for (const s of workers) {
    for (const n of c.matches.get(s.id).keys()) if (c.byNum.get(n).state === 'open') perIssue.set(n, [...(perIssue.get(n) || []), s])
  }
  for (const [n, list] of [...perIssue].sort((a, b) => a[0] - b[0])) {
    if (list.length < 2) continue
    const claim = c.claims.get(n)
    const live = claim && !claim.released ? claim.session : null
    const keep = live && list.some((s) => s.id === live) ? `keep ${code(live)}, named in the live CLAIM` : 'keep the newest one that is working'
    c.add('duplicate-session', list.map((s) => s.id), n, `${list.length} sessions match it: ${list.map((s) => code(s.bucket || s.status)).join(', ')}.`,
      `Dispatcher: ${keep}; archive the others only once they are completed.`)
  }
}

// A live CLAIM on an open issue whose session is gone, archived or failed. The dispatcher's own claims are left out.
// "Gone" needs every session of the account: a dump made with children=true holds only one dispatcher's children.
function checkClaims(c, parents) {
  // Every session of the dump, in scope or not: a claimed session without tags is still alive.
  const byId = new Map(c.allSessions.map((s) => [s.id, s]))
  for (const [n, claim] of [...c.claims].sort((a, b) => a[0] - b[0])) {
    if (claim.released || c.byNum.get(n)?.state !== 'open' || parents.has(claim.session)) continue
    const s = claim.session ? byId.get(claim.session) : null
    let why = null
    if (!claim.session) why = 'the CLAIM names no session id'
    else if (!s && !c.childrenOnly) why = 'its session is not in the dump (archived, gone, or left out): check it with `get_session` before a release'
    else if (s && (s.status === 'archived' || s.bucket === 'failed')) why = `its session is ${code(s.status === 'archived' ? 'archived' : 'failed')}`
    if (why) c.add('orphan-claim', claim.session ? [claim.session] : [], n, `${ref(n)} has a CLAIM with no RELEASE; ${why}.`, 'Dispatcher watchdog: check the session with `get_session`, then resume it, start a new one, or release the claim.')
  }
}

// Pass 1 finds duplicate issues; the sessions on either issue are added.
function checkDuplicateIssues(c, snapshot, workers) {
  for (const f of passOne({ ...snapshot, comments: c.allComments }, { today: new Date(c.now).toISOString() }).filter((x) => x.kind === 'duplicate')) {
    const ids = workers.filter((s) => f.issues.some((n) => c.matches.get(s.id).has(n))).map((s) => s.id)
    // A session on either issue means work has started: the dispatcher decides, the agent closes nothing.
    const what = ids.length ? `${f.what.replace(/\.$/, '')}; ${ids.length} ${ids.length > 1 ? 'sessions match' : 'session matches'} them.` : f.what
    c.add('duplicate-issue', ids, f.issues[1], what, f.fix, ids.length ? 'dispatcher' : f.act)
  }
}

/**
 * Every check. Returns findings { kind, sessions, issue, evidence, action, act }, act = allowed | dispatcher | owner.
 * `pulls` maps an open PR number to { checks: green | red | pending, codex_threads: n } (read by the agent).
 */
export function analyzeSessions(sessionsDoc, snapshot, { today, comments = {}, pulls = {}, reviewHours = REVIEW_HOURS, staleDays = STALE_DAYS } = {}) {
  const now = Date.parse(today || sessionsDoc.read_at)
  if (Number.isNaN(now)) throw new Error(`not an ISO time: ${today || sessionsDoc.read_at}`)
  const out = []
  const c = context(sessionsDoc, snapshot, comments)
  Object.assign(c, {
    now,
    pulls,
    reviewHours,
    staleDays,
    stuck: new Set(),
    add: (kind, ids, issue, evidence, action, act = 'dispatcher') => out.push({ kind, sessions: ids, issue, evidence, action, act })
  })
  for (const s of c.workers) checkSession(c, s)
  checkDuplicateSessions(c, c.workers)
  checkClaims(c, c.parents)
  checkDuplicateIssues(c, snapshot, c.workers)
  // Last: a completed session is "can be archived" only when no other finding names it.
  for (const s of c.workers.filter((x) => !c.stuck.has(x.id))) {
    const first = [...c.matches.get(s.id).keys()].sort((a, b) => a - b)[0] ?? null
    // A duplicate-session finding already says to archive the completed ones, so it does not hold a session back.
    checkStale(c, s, first, out.some((f) => f.kind !== 'duplicate-session' && f.sessions.includes(s.id)))
  }
  const rank = new Map(KINDS.map(([k], i) => [k, i]))
  return out.sort((a, b) => rank.get(a.kind) - rank.get(b.kind) || (a.issue ?? 0) - (b.issue ?? 0) || String(a.sessions[0]).localeCompare(String(b.sessions[0])))
}

/** Sessions, issues, comment facts and matches, shared by the report and the `need` command. */
function context(sessionsDoc, snapshot, comments) {
  const allComments = { ...(snapshot.comments || {}), ...comments }
  const issues = (snapshot.issues || []).map(normalize)
  const naming = (list, re) => (list || []).filter((p) => re.test(`${p.title}\n${p.body || ''}`)).map((p) => p.number).sort((a, b) => a - b)
  const c = {
    childrenOnly: /children/i.test(sessionsDoc.source || ''),
    allSessions: (sessionsDoc.sessions || []).map(normalizeSession),
    allComments,
    loaded: (n) => allComments[n] || allComments[String(n)],
    issues,
    byNum: new Map(issues.map((i) => [i.number, i])),
    merged: new Map((snapshot.pulls || []).map((p) => [p.number, p])),
    mergedNaming: (n) => naming(snapshot.pulls, new RegExp(`\\b(closes|fixes|resolves|implements)\\s+#${n}\\b`, 'i')),
    openNaming: (n) => naming(snapshot.open_pulls, new RegExp(`#${n}\\b`)),
    owner: String(snapshot.repo || REPO).split('/')[0]
  }
  c.sessions = scoped(c.allSessions).sort((a, b) => a.id.localeCompare(b.id))
  c.facts = new Map(issues.filter((i) => i.state === 'open').map((i) => [i.number, commentFacts(c.loaded(i.number), { owner: c.owner })]))
  matchAll(c)
  // A session that is the parent of another one is the dispatcher: it has no issue of its own.
  c.parents = new Set(c.sessions.map((s) => s.parent).filter(Boolean))
  c.workers = c.sessions.filter((s) => !c.parents.has(s.id))
  return c
}

/** The counts at the top of the summary: every session read, the ones in scope, pages and issues. */
export function summaryCounts(doc, snapshot) {
  const sessions = (doc.sessions || []).map(normalizeSession)
  return { sessions: doc.read_total ?? sessions.length, inScope: scoped(sessions).length, pages: doc.pages, issues: (snapshot.issues || []).length }
}

/** Issues whose comments the report still needs, and open PRs whose checks it needs (for the `need` command). */
export function needs(sessionsDoc, snapshot, comments = {}) {
  const c = context(sessionsDoc, snapshot, comments)
  const isOpen = (n) => c.byNum.get(n)?.state === 'open'
  const wanted = new Set([...(snapshot.markers?.claim || []), ...(snapshot.markers?.release || [])])
  for (const s of c.workers) for (const n of c.matches.get(s.id).keys()) wanted.add(n)
  const issues = [...wanted].filter((n) => isOpen(n) && !c.loaded(n)).sort((a, b) => a - b)
  const review = c.workers.filter((s) => s.bucket === 'review_ready').flatMap((s) => [...c.matches.get(s.id).keys()].filter(isOpen))
  const prs = [...new Set(review.flatMap((n) => c.openNaming(n)))].sort((a, b) => a - b)
  return { issues, prs }
}

const LABELS = new Map(KINDS)
// One table cell: one line, and a "|" (from pass 1 text or an agent's words) cannot end the cell.
const cell = (text) => String(text).replace(/\s+/g, ' ').replace(/\|/g, '/')
// GitHub refuses a comment over 65 536 characters; above this the skill posts pass 1 as a second comment.
export const COMMENT_MAX = 60000
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** 3 to 6 words for a pull request: its title, padded with "pull request" when it has fewer than 3 words. */
function prName(title) {
  const words = title.replace(/[`"()[\]:|]/g, ' ').split(/\s+/).filter(Boolean)
  if (words.length >= 3) return shortName({ title })
  return [...words, 'pull', 'request'].map((w) => (/^[A-Z]\d+(\.\d+)?$/.test(w) ? `\`${w}\`` : w)).join(' ')
}

/** 3 to 6 words for every issue and pull request in the snapshot (open PRs too), keyed by number. */
export function describeSnapshot(snapshot) {
  const names = describeAll(snapshot)
  const issues = new Set((snapshot.issues || []).map((i) => i.number))
  // A short PR title is padded with "pull request", not with the word "issue" that shortName adds.
  for (const p of [...(snapshot.pulls || []), ...(snapshot.open_pulls || [])]) {
    if (!issues.has(p.number)) names.set(p.number, prName(p.title || ''))
  }
  // A "|" in a title would break the Details table, and it is not a word: the name is made again without it.
  for (const i of snapshot.issues || []) if (/\|/.test(i.title || '')) names.set(i.number, shortName({ title: i.title.replace(/\|/g, ' ') }))
  for (const [n, words] of names) names.set(n, words.replace(/\|/g, ' ').replace(/\s+/g, ' '))
  return names
}

/**
 * The summary text (template: .claude/skills/reply-style/templates/janitor-summary.md). Pure: the golden test pins it.
 * counts: { sessions, pages, issues }; applied: [{ issue, what }]; pass1: the pass 1 report text, or ''.
 */
export function formatSummary(findings, { counts, today, repo = REPO, names = new Map(), applied = [], pass1 = '' }) {
  const seen = new Set([154])
  const x = (text) => expand(text, names, seen)
  const dispatcher = findings.filter((f) => f.act === 'dispatcher').length
  const owner = findings.filter((f) => f.act === 'owner')
  const lines = [
    `Janitor report, ${String(today).slice(0, 10)}: ${plural(counts.sessions, 'session')} read in ${plural(counts.pages, 'page')}, ${counts.inScope} in scope,`,
    `${plural(counts.issues, 'issue')} read, ${plural(findings.length, 'finding')} (counts checked).`,
    '',
    '| Finding kind | Count |',
    '|---|---|',
    ...KINDS.map(([k, label]) => `| ${label} (\`${k}\`) | ${findings.filter((f) => f.kind === k).length} |`),
    '',
    '## TL;DR',
    `The janitor matched ${plural(counts.inScope, 'session')} in scope with their issues: ${plural(findings.length, 'finding')}, ${plural(applied.length, 'fix', 'fixes')} applied (checked).`,
    dispatcher ? `${plural(dispatcher, 'finding is', 'findings are')} for the dispatcher, in the table below.` : 'No finding is for the dispatcher.',
    owner.length ? `You need to do ${owner.length} ${owner.length === 1 ? 'thing' : 'things'} (below).` : 'Nothing needed from you.',
    '',
    '## What you need to do'
  ]
  if (owner.length) owner.forEach((f, k) => lines.push(`${k + 1}. ${x(f.action)} Where: ${f.issue ? x(ref(f.issue)) : 'the session below'}.`))
  else lines.push('Nothing.')
  lines.push('', '## Waiting for')
  if (dispatcher) {
    lines.push(`- [#154 dispatcher queue issue](https://github.com/${repo}/issues/154): acts on the ${plural(dispatcher, '`dispatcher` finding')} below.`,
      '  Expected: its next pass, time not known.')
  } else lines.push('Nothing.')
  lines.push('', '## Blocked on you')
  if (owner.length) owner.forEach((f) => lines.push(`- ${x(f.evidence)}`))
  else lines.push('Nothing.')
  lines.push('', '## Done', `- Read ${plural(counts.sessions, 'session')} in ${plural(counts.pages, 'page')} (\`has_more\` false) and ${plural(counts.issues, 'issue')}, checked.`,
    `- Checked ${plural(counts.inScope, 'session')} in scope (tagged \`pipeline\` or \`epic-<n>\`, with their dispatcher); the others belong to other projects.`)
  for (const a of applied) lines.push(`- ${x(ref(a.issue))}: ${String(a.what).replace(/\s+/g, ' ')}, checked.`)
  if (!applied.length) lines.push('- No fix applied in this run.')
  lines.push('', '## Details', '### Findings')
  if (!findings.length) lines.push('No findings.')
  else {
    lines.push('| Kind | Session | Issue | Evidence | Proposed action |', '|---|---|---|---|---|')
    for (const f of findings) {
      const sessions = f.sessions.length ? f.sessions.map(code).join(', ') : 'none'
      const issue = f.issue ? x(ref(f.issue)) : 'none'
      const cells = [LABELS.get(f.kind), sessions, issue, x(f.evidence), `${x(f.action)} \`${f.act}\``].map(cell)
      lines.push(`| ${cells.join(' | ')} |`)
    }
  }
  if (pass1.trim()) lines.push('', '### Pass 1 report (task janitor)', pass1.trim())
  return lines.join('\n') + '\n'
}

function main() {
  const [cmd, sessionsFile, snapshotFile, ...rest] = process.argv.slice(2)
  const opt = (name) => { const k = rest.indexOf(name); return k === -1 ? null : rest[k + 1] }
  const json = (f) => (f ? JSON.parse(readFileSync(f, 'utf8')) : {})
  if (!['need', 'findings', 'report'].includes(cmd) || !sessionsFile || !snapshotFile) {
    console.error('usage: session-janitor.mjs need|findings|report sessions.json snapshot.json [--comments f] [--pulls f] [--today ISO]'
      + ' [--review-hours N] [--stale-days N] [--applied f] [--pass1 f]')
    process.exit(2)
  }
  const doc = json(sessionsFile)
  const errors = validateSessions(doc)
  if (errors.length) {
    console.error(errors.join('\n'))
    process.exit(1)
  }
  const snapshot = json(snapshotFile)
  const comments = json(opt('--comments'))
  if (cmd === 'need') {
    const n = needs(doc, snapshot, comments)
    console.log(`Load comments for ${n.issues.length} issues: ${n.issues.map((x) => `#${x}`).join(' ') || 'none'}`)
    console.log(`Read checks and Codex threads for ${n.prs.length} open PRs: ${n.prs.map((x) => `#${x}`).join(' ') || 'none'}`)
    return
  }
  const number = (name, fallback) => {
    const v = Number(opt(name) ?? fallback)
    if (!(v >= 0)) {
      console.error(`${name} must be a number of 0 or more`)
      process.exit(2)
    }
    return v
  }
  const today = opt('--today') || doc.read_at
  if (!validTime(today)) {
    console.error('--today must be an ISO time')
    process.exit(2)
  }
  const findings = analyzeSessions(doc, snapshot, {
    today,
    comments,
    pulls: json(opt('--pulls')),
    reviewHours: number('--review-hours', REVIEW_HOURS),
    staleDays: number('--stale-days', STALE_DAYS)
  })
  if (cmd === 'findings') {
    process.stdout.write(JSON.stringify(findings, null, 1) + '\n')
    return
  }
  const text = formatSummary(findings, {
    counts: summaryCounts(doc, snapshot),
    today,
    repo: snapshot.repo || REPO,
    names: describeSnapshot(snapshot),
    applied: opt('--applied') ? json(opt('--applied')) : [],
    pass1: opt('--pass1') ? readFileSync(opt('--pass1'), 'utf8') : ''
  })
  process.stdout.write(text)
  console.error(`summary: ${text.length} characters${text.length > COMMENT_MAX ? `, over ${COMMENT_MAX}: leave out --pass1 and post pass1.txt as a second comment` : ''}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
