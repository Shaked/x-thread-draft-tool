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
//
// analyzeSessions() is pure: the tests run it on fixtures.

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { analyze as passOne, commentFacts, normalize, REPO } from './janitor.mjs'

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
  if (doc.has_more !== false) errors.push('has_more must be false: read every page (after_id = last_id) before the report')
  if (!Array.isArray(doc.sessions)) return [...errors, 'sessions must be an array']
  const ids = new Set()
  doc.sessions.forEach((s, k) => {
    for (const f of SESSION_FIELDS) if (!(f in (s || {}))) errors.push(`sessions[${k}]: missing ${f}`)
    if (typeof s?.id !== 'string' || !/^session_\w+$/.test(s.id)) errors.push(`sessions[${k}]: id must look like session_...`)
    else if (ids.has(s.id)) errors.push(`sessions[${k}]: ${s.id} is listed twice`)
    else ids.add(s.id)
  })
  return errors
}

/** The issue number a session title names: the first "#NNN". */
export function titleIssue(title) {
  const m = /#(\d+)\b/.exec(title || '')
  return m ? Number(m[1]) : null
}

const TOKEN = /\b(?:gh[pousr]_\w{16,}|github_pat_\w{16,}|sk-[\w-]{16,}|xox[abprs]-[\w-]{10,}|eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{4,})|\bBearer\s+\S+|[A-Za-z0-9+/_-]{32,}/g

/** Text copied from a session for a table cell: one line, no backticks or pipes, tokens masked, at most `max` characters. */
export function quote(text, max = 100) {
  const one = String(text || '').replace(/\s+/g, ' ').replace(/`/g, "'").replace(/\|/g, '/').replace(TOKEN, '[redacted]').trim()
  return one.length > max ? `${one.slice(0, max - 3).trimEnd()}...` : one
}

/** Live CLAIM per open issue: { session, at, released } from the last CLAIM comment. */
export function claimOf(comments = []) {
  let claim = null
  for (const c of [...comments].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
    const body = c.body || ''
    const first = body.split('\n')[0]
    if (/^CLAIM\b/.test(first)) {
      const m = /\bsession\s+(session_\w+)/.exec(first)
      claim = { session: m ? m[1] : null, at: c.created_at, released: false }
    } else if (claim && /^RELEASE\s*$/m.test(body)) claim.released = true
  }
  return claim
}

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
    const list = c.loaded(i.number) || []
    const claim = claimOf(list)
    if (claim) c.claims.set(i.number, claim)
    for (const x of list) {
      const first = (x.body || '').split('\n')[0]
      if (/^CLAIM\b/.test(first)) for (const m of first.matchAll(/\bsession\s+(session_\w+)/g)) match(m[1], i.number, 'claim')
      if (/^HANDOFF\b/.test(first)) for (const m of (x.body || '').matchAll(/\b(session_[A-Za-z0-9]+)/g)) match(m[1], i.number, 'handoff')
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
  const named = n !== null ? `; its title names #${n}, which is not in the issue list` : '; no issue number in its title, no CLAIM or HANDOFF names it'
  c.add('orphan-session', [s.id], null, `${state(s)}${named}.`, 'Read it: link it to its issue with a CLAIM, or archive it once it is completed.')
}

/** A finished session on an open issue: done (close it) or no HANDOFF (ask for it). */
function checkDone(c, s, n) {
  if (!FINISHED.has(s.bucket)) return
  const f = c.facts.get(n)
  const done = Boolean(f.last?.done && f.last.release)
  const prs = c.mergedNaming(n)
  const how = `matched by ${c.matches.get(s.id).get(n).join(' and ')}`
  if (done || prs.length) {
    const prMerged = Boolean(done && f.last.pr && c.merged.has(f.last.pr))
    const pr = done && f.last.pr ? `; PR ${ref(f.last.pr)} is ${prMerged ? 'merged' : 'not in the merged list'}` : ''
    const evidence = done ? `${state(s)}; the last HANDOFF says done and has RELEASE${pr}` : `${state(s)}; merged PR ${prs.map(ref).join(', ')} names it; no done HANDOFF`
    if (prMerged) c.add('done-open', [s.id], n, `${evidence}; ${how}.`, `Close ${ref(n)} as completed after reading its HANDOFF.`, 'allowed')
    else c.add('done-open', [s.id], n, `${evidence}; ${how}.`, 'Read the PRs and the issue: close it, or write in the issue what is left.')
  } else if (!c.openNaming(n).length && !f.handoffs.length) {
    const note = c.loaded(n) ? 'no HANDOFF comment' : 'comments not loaded'
    c.add('no-handoff', [s.id], n, `${state(s)}; ${note}; no open PR names it; ${how}.`, 'Ask the session to post its HANDOFF with RELEASE.')
  }
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
  if (s.bucket !== 'review_ready' || !openPrs.length || age <= c.reviewHours) return
  const flags = openPrs.map((p) => prFlag(c, p))
  c.add('nudge-merge', [s.id], n, `${state(s)} for ${Math.floor(age)} hours; ${flags.map((x) => x.text).join('; ')}.`,
    flags.some((x) => x.red) ? 'Nudge it: fix the red checks and answer the Codex threads, then merge.' : 'Nudge it to merge once Opus has judged the final head.')
}

function checkStale(c, s, issue) {
  const days = (c.now - Date.parse(s.updatedAt)) / 86400000
  if (s.bucket === 'working' || days <= c.staleDays) return
  const action = s.bucket === 'completed' ? 'Can be archived: it is completed.' : 'Not completed, so never archive it: read why it stopped.'
  c.add('stale', [s.id], issue, `${state(s)}; no update for ${Math.floor(days)} days.`, action)
}

function checkSession(c, s) {
  const found = [...c.matches.get(s.id).keys()].sort((a, b) => a - b)
  const stuck = checkStuck(c, s, found[0] ?? null)
  if (!found.length) checkOrphan(c, s)
  for (const n of found.filter((k) => c.byNum.get(k).state === 'open')) {
    checkDone(c, s, n)
    checkReview(c, s, n)
  }
  if (!stuck) checkStale(c, s, found[0] ?? null)
}

// Two or more sessions (the dispatcher left out) match one issue.
function checkDuplicateSessions(c, workers) {
  const perIssue = new Map()
  for (const s of workers) for (const n of c.matches.get(s.id).keys()) perIssue.set(n, [...(perIssue.get(n) || []), s])
  for (const [n, list] of [...perIssue].sort((a, b) => a[0] - b[0])) {
    if (list.length < 2) continue
    const claim = c.claims.get(n)
    const live = claim && !claim.released ? claim.session : null
    const keep = live && list.some((s) => s.id === live) ? `keep ${code(live)}, named in the live CLAIM` : 'keep the newest one that is working'
    c.add('duplicate-session', list.map((s) => s.id), n, `${list.length} sessions match it: ${list.map((s) => code(s.bucket || s.status)).join(', ')}.`,
      `Dispatcher: ${keep}; archive the others only once they are completed.`)
  }
}

// A live CLAIM on an open issue whose session is gone, archived or failed.
function checkClaims(c) {
  const byId = new Map(c.sessions.map((s) => [s.id, s]))
  for (const [n, claim] of [...c.claims].sort((a, b) => a[0] - b[0])) {
    if (claim.released || c.byNum.get(n)?.state !== 'open') continue
    const s = claim.session ? byId.get(claim.session) : null
    let why = null
    if (!claim.session) why = 'the CLAIM names no session id'
    else if (!s) why = 'its session is not in the session list (archived or gone)'
    else if (s.status === 'archived' || s.bucket === 'failed') why = `its session is ${code(s.status === 'archived' ? 'archived' : 'failed')}`
    if (why) c.add('orphan-claim', claim.session ? [claim.session] : [], n, `${ref(n)} has a CLAIM with no RELEASE; ${why}.`, 'Dispatcher watchdog: resume the session or start a new one, or release the claim.')
  }
}

// Pass 1 finds duplicate issues; the sessions on either issue are added.
function checkDuplicateIssues(c, snapshot) {
  for (const f of passOne({ ...snapshot, comments: c.allComments }, { today: new Date(c.now).toISOString() }).filter((x) => x.kind === 'duplicate')) {
    const ids = c.sessions.filter((s) => f.issues.some((n) => c.matches.get(s.id).has(n))).map((s) => s.id)
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
  const allComments = { ...(snapshot.comments || {}), ...comments }
  const issues = (snapshot.issues || []).map(normalize)
  const naming = (list, re) => (list || []).filter((p) => re.test(`${p.title}\n${p.body || ''}`)).map((p) => p.number).sort((a, b) => a - b)
  const out = []
  const c = {
    now: Date.parse(today || sessionsDoc.read_at),
    sessions: (sessionsDoc.sessions || []).map(normalizeSession).sort((a, b) => a.id.localeCompare(b.id)),
    allComments,
    loaded: (n) => allComments[n] || allComments[String(n)],
    issues,
    byNum: new Map(issues.map((i) => [i.number, i])),
    merged: new Map((snapshot.pulls || []).map((p) => [p.number, p])),
    mergedNaming: (n) => naming(snapshot.pulls, new RegExp(`\\b(closes|fixes|resolves|implements)\\s+#${n}\\b`, 'i')),
    openNaming: (n) => naming(snapshot.open_pulls, new RegExp(`#${n}\\b`)),
    pulls,
    reviewHours,
    staleDays,
    add: (kind, ids, issue, evidence, action, act = 'dispatcher') => out.push({ kind, sessions: ids, issue, evidence, action, act })
  }
  const owner = String(snapshot.repo || REPO).split('/')[0]
  c.facts = new Map(issues.filter((i) => i.state === 'open').map((i) => [i.number, commentFacts(c.loaded(i.number), { owner })]))
  matchAll(c)
  // A session that is the parent of another one is the dispatcher: it has no issue of its own.
  const parents = new Set(c.sessions.map((s) => s.parent).filter(Boolean))
  const workers = c.sessions.filter((s) => !parents.has(s.id))
  for (const s of workers) checkSession(c, s)
  checkDuplicateSessions(c, workers)
  checkClaims(c)
  checkDuplicateIssues(c, snapshot)
  const rank = new Map(KINDS.map(([k], i) => [k, i]))
  return out.sort((a, b) => rank.get(a.kind) - rank.get(b.kind) || (a.issue ?? 0) - (b.issue ?? 0) || String(a.sessions[0]).localeCompare(String(b.sessions[0])))
}

/** Issues whose comments the report still needs, and open PRs whose checks it needs (for the `need` command). */
export function needs(sessionsDoc, snapshot, comments = {}) {
  const all = { ...(snapshot.comments || {}), ...comments }
  const openSet = new Set((snapshot.issues || []).filter((i) => String(i.state).toLowerCase() === 'open').map((i) => i.number))
  const sessions = (sessionsDoc.sessions || []).map(normalizeSession)
  const parents = new Set(sessions.map((s) => s.parent).filter(Boolean))
  const wanted = new Set([...(snapshot.markers?.claim || []), ...(snapshot.markers?.release || [])])
  for (const s of sessions.filter((x) => !parents.has(x.id))) {
    const n = titleIssue(s.title)
    if (n !== null && openSet.has(n)) wanted.add(n)
  }
  const issues = [...wanted].filter((n) => openSet.has(n) && !(all[n] || all[String(n)])).sort((a, b) => a - b)
  const review = new Set(sessions.filter((s) => s.bucket === 'review_ready').map((s) => titleIssue(s.title)).filter((n) => n !== null))
  const prs = (snapshot.open_pulls || []).filter((p) => [...review].some((n) => new RegExp(`#${n}\\b`).test(`${p.title}\n${p.body || ''}`))).map((p) => p.number).sort((a, b) => a - b)
  return { issues, prs }
}

function main() {
  const [cmd, sessionsFile, snapshotFile, ...rest] = process.argv.slice(2)
  const opt = (name) => { const k = rest.indexOf(name); return k === -1 ? null : rest[k + 1] }
  const json = (f) => (f ? JSON.parse(readFileSync(f, 'utf8')) : {})
  if (!['need', 'findings'].includes(cmd) || !sessionsFile || !snapshotFile) {
    console.error('usage: session-janitor.mjs need|findings sessions.json snapshot.json [--comments f] [--pulls f] [--today ISO] [--review-hours N] [--stale-days N]')
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
  const findings = analyzeSessions(doc, snapshot, {
    today: opt('--today') || doc.read_at,
    comments,
    pulls: json(opt('--pulls')),
    reviewHours: Number(opt('--review-hours') || REVIEW_HOURS),
    staleDays: Number(opt('--stale-days') || STALE_DAYS)
  })
  process.stdout.write(JSON.stringify(findings, null, 1) + '\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
