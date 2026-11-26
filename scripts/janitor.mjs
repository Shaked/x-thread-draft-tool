#!/usr/bin/env node
// Task janitor (#458, phase 1): a read-only report on the issue list. Node 20, no dependencies, no model.
// It never writes to GitHub. The agent acts on the report with the rules in .claude/skills/task-janitor/SKILL.md.
//
//   node scripts/janitor.mjs fetch > snapshot.json
//       Reads issues, merged pull requests and comment markers with `gh api search/issues` (allowed in agent
//       sessions; in CI, gh reads GH_TOKEN or GITHUB_TOKEN). Comment bodies are not fetched.
//   node scripts/janitor.mjs report snapshot.json [--comments comments.json] [--today YYYY-MM-DD] [--stale-days N]
//       Prints the report. comments.json maps an issue number to [{ user, created_at, body }], read with the
//       GitHub tools for the issues the report asks about (HANDOFF, CLAIM, held and owner issues).
//
// analyze() and formatReport() are pure: the tests run them on fixtures, without network.

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const REPO = 'Shaked/x-thread-draft-tool'
export const STALE_DAYS = 14
export const CLAIM_STALE_HOURS = 3
export const SUB_ISSUE_LIMIT = 100
export const NEAR_LIMIT = 90
// A name shared by more open issues than this is common (for example `drafts`), not an overlap.
export const RARE_NAME_MAX = 4
export const SIMILAR_TITLE = 0.6
const IGNORED_FILES = /^(AGENTS\.md|CLAUDE\.md|README\.md|package(-lock)?\.json|docs\/changelogs\/.*|tests\/.*)$/
const STOP = new Set(['a', 'an', 'and', 'the', 'of', 'to', 'in', 'on', 'for', 'with', 'by', 'from', 'is', 'it', 'or', 'as', 'at', 'its', 'no', 'not'])

const num = (url) => (url ? Number(String(url).split('/').pop()) : null)
const labelsOf = (i) => (i.labels || []).map((l) => (typeof l === 'string' ? l : l.name))
const has = (i, name) => labelsOf(i).includes(name)

/** Turns REST issue objects into the shape the checks use. */
export function normalize(issue) {
  return {
    number: issue.number,
    title: issue.title || '',
    body: issue.body || '',
    state: String(issue.state || '').toLowerCase(),
    stateReason: issue.state_reason || null,
    labels: labelsOf(issue),
    parent: issue.parent ?? num(issue.parent_issue_url),
    subIssues: issue.sub_issues_summary?.total ?? 0,
    updatedAt: issue.updated_at,
    createdAt: issue.created_at
  }
}

/** Title without its task prefix ("E273 task O2: "), cut at the first parenthesis. */
export function titleText(title) {
  const colon = title.indexOf(': ')
  const rest = colon > 0 && colon < 40 ? title.slice(colon + 2) : title
  return rest.split(' (')[0].trim()
}

/** 3 to 6 words that say what an issue is, for "#n (words)". */
export function shortName(issue) {
  let words = titleText(issue.title).replace(/[`"()[\]]/g, '').split(/\s+/).filter(Boolean)
  if (words.length < 3) words = issue.title.replace(/[`"()[\]:]/g, '').split(/\s+/).filter(Boolean)
  // Task ids like M1 or H20 inside the words would need their own description, so they are code spans.
  // Words the reply-style lint reserves ("unchanged", "blocked") are left out of a description.
  words = words.filter((w) => !/^(unchanged|blocked|blocking)[,.:;]?$/i.test(w))
  while (words.length < 3) words.push(words.length === 2 ? 'issue' : 'the')
  return words.slice(0, 5).map((w) => (/^[A-Z]\d+(\.\d+)?[,.]?$/.test(w) ? `\`${w.replace(/[,.]$/, '')}\`` : w)).join(' ').replace(/[,.:;]$/, '')
}

/** The plan task id of a title ("O2", "Task 5", "L1 (b)" gives "L1") and its scope (epic). */
export function taskId(issue) {
  const m = /^(?:E(\d+)\s+)?(?:[Tt]ask\s+)?([A-Z]{1,2}\d+[a-z]?(?:\s+[A-Z]\d+)?|\d+(?:\.\d+)?)(\s*\([a-z]\d?\))?(?:\s*\([^)]*\))?\s*:/.exec(issue.title)
  if (!m) return null
  return { id: m[2] + (m[3] ? m[3].trim().replace('(', ' (') : ''), prefix: m[1] ? Number(m[1]) : null }
}

function words(title) {
  return new Set(titleText(title).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w)))
}

export function similarity(a, b) {
  const x = words(a)
  const y = words(b)
  if (!x.size || !y.size) return 0
  let both = 0
  for (const w of x) if (y.has(w)) both++
  return both / (x.size + y.size - both)
}

const NEGATION = /\b(not|until|start|no longer)\b|n't\b/i
const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])

// One clause: it ends at the sentence end, at the next dependency keyword, or where the next field starts.
// Code spans are not dependencies; a "PR #n" or "see #n" is not one either.
function dependencyClause(rest, refs, named) {
  const [keyword] = /^\S+\s+\S+/.exec(rest)
  const tail = rest.slice(keyword.length).split(/\b(?:Done when|PR (?:body )?lines?|Owner steps|depends on|blocked by|starts after|goes before)\b|[.;,]\s*before\s+#|\.\s+(?=[A-Z])/i)[0]
  const text = (keyword + tail).replace(/`[^`]*`/g, ' ')
  for (const m of text.matchAll(/(PR\s+|see\s+)?#(\d+)/gi)) if (!m[1]) refs.add(Number(m[2]))
  // Task ids named without a number, outside parentheses: "Depends on: M5 (see #439)" names M5; "C2 (#418)" has its number.
  let bare = text.replace(/\b[A-Z]{1,2}\d+[a-z]?\s*\(#\d+[^)]*\)/g, ' ')
  // An owner question is not a task: "owner question Q1", "answer Q2" and "Q-W2" name no task, even where a task Q1 exists.
  bare = bare.replace(/\b(?:owner|questions?|answers?|answered)\s+(?:\S+\s+){0,2}?[A-Z]{1,2}\d+[a-z]?(?![\w-])/gi, ' ')
  // A split-task suffix is part of the id, as taskId() reads it: "L1 (b)" is not "L1".
  bare = bare.replace(/(?<![\w-])([A-Z]{1,2}\d+[a-z]?)\s*\(([a-z]\d?)\)/g, (_, id, part) => {
    named.add(`${id} (${part})`)
    return ' '
  })
  bare = bare.replace(/\([^)]*\)/g, ' ').replace(/#\d+/g, ' ')
  for (const m of bare.matchAll(/(?<![\w-])([A-Z]{1,2}\d+[a-z]?)(?![\w-])/g)) named.add(m[1])
}

/** Issue numbers on "Depends on", "Blocked by" and "starts after" lines. A "PR #n" or "see #n" is not a dependency. */
export function dependencies(body) {
  const refs = new Set()
  const named = new Set()
  const before = new Set()
  // Fenced blocks are skipped and code spans masked, so a quoted example ("`Depends on A2`") never adds a dependency.
  let fenced = false
  const lines = body.split('\n').filter((l) => {
    if (/^\s*(```|~~~)/.test(l)) {
      fenced = !fenced
      return false
    }
    return !fenced
  })
  for (const line of lines.map((l) => l.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length)))) {
    // "Goes before #n" only at the start of a clause, and never after "not", "until" or "start".
    // A clause starts at the line start (after a list marker such as "- " or "1. "), or after "." or ";".
    for (const m of line.matchAll(/(?:^\s*(?:[-*+]\s+|\d+\.\s+)?|[.;]\s+)(?:goes\s+)?before\s+#(\d+)/gi)) {
      if (!NEGATION.test(line.slice(Math.max(0, m.index - 20), m.index + m[0].length))) before.add(Number(m[1]))
    }
    for (const m of line.matchAll(/\b(depends on|blocked by|starts after)\b/gi)) {
      if (/\b(not|no longer)\s+$|n't\s+$/i.test(line.slice(Math.max(0, m.index - 12), m.index))) continue
      dependencyClause(line.slice(m.index), refs, named)
    }
  }
  return { refs: [...refs], named: [...named], before: [...before] }
}

/** File paths, API and page routes, and database tables named in a body. */
export function names(body, knownTables = []) {
  const found = new Set()
  const known = new Set(knownTables)
  const ticks = [...body.matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim())
  for (const t of ticks) {
    if (/^[\w.-]+(\/[\w.-]+)+\.\w+$/.test(t) && !IGNORED_FILES.test(t)) found.add(t)
    else if (/^(GET |POST |PUT |PATCH |DELETE )?\/(api\/[\w/:{}-]+|[a-z][\w-]*\/[\w/:{}-]+)$/.test(t)) found.add(t.replace(/^\w+ /, '').replace(/\/$/, ''))
    else if (known.has(t)) found.add(t)
  }
  for (const m of body.matchAll(/(?:GET|POST|PUT|PATCH|DELETE)\s+`?(\/api\/[\w/:{}-]+)/g)) found.add(m[1].replace(/\/$/, ''))
  // Tables a migration line creates: "creates `a`, `b` ..." up to the first colon, or the bullets under a migration line.
  const lines = body.split('\n')
  lines.forEach((line, k) => {
    const creates = /\bcreates?\s+(.*)/i.exec(line)
    if (creates && /migration|table/i.test(line)) {
      for (const m of creates[1].split(/[:(]/)[0].matchAll(/`([a-z][a-z0-9_]*_[a-z0-9_]+)`/g)) found.add(m[1])
    }
    if (/migration/i.test(line)) {
      for (let j = k + 1; j < lines.length && /^\s+- `/.test(lines[j]); j++) {
        const m = /^\s+- `([a-z][a-z0-9_]*)`:/.exec(lines[j])
        if (m) found.add(m[1])
      }
    }
  })
  return [...found]
}

/**
 * HANDOFF and CLAIM facts from an issue's comments, in time order. A HANDOFF counts only from a trusted author
 * (author_association OWNER, MEMBER or COLLABORATOR, or the repo owner's login), and is done only when the status
 * after its last " - " is exactly "done".
 */
export function commentFacts(comments = [], { owner = REPO.split('/')[0] } = {}) {
  const handoffs = []
  let claim = null
  const sorted = [...comments].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  for (const c of sorted) {
    const body = c.body || ''
    const first = body.split('\n')[0]
    const release = /^RELEASE\s*$/m.test(body)
    const trusted = TRUSTED.has(c.author_association) || c.user === owner
    if (/^HANDOFF\b/.test(first) && trusted) {
      const pr = /PR:?\s*#(\d+)/.exec(body) || /\bPR #(\d+)\b/.exec(body) || /\/pull\/(\d+)/.exec(body)
      const status = first.slice(first.lastIndexOf(' - ') + 3).trim().toLowerCase()
      handoffs.push({ at: c.created_at, first, release, done: first.includes(' - ') && status === 'done', pr: pr ? Number(pr[1]) : null })
    }
    if (/^CLAIM\b/.test(first)) {
      const hb = /heartbeat\s+(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?Z?)/i.exec(first)
      claim = { at: c.created_at, heartbeat: hb ? hb[1].replace(' ', 'T').replace(/Z?$/, 'Z') : c.created_at, released: false }
    } else if (claim && release) claim.released = true
  }
  return { handoffs, claim, last: handoffs[handoffs.length - 1] || null }
}

const OWNER_QUESTION = /owner (answer|question|decision|step|approval|action|check)|owner only|Shaked's (approval|go)|answers? (Q|H\d-Q)|\bQ-?[A-Z]*\d\b|What is decided|only Shaked|Shaked (answers|decides|confirms|creates|approves|reports)|owner-only/i

// {#n} is expanded by formatReport: the first mention gets its 3 to 6 words.
const ref = (n) => `{#${n}}`
const refs = (list) => list.map(ref).join(', ')
const isEpic = (i) => has(i, 'epic') || has(i, 'dispatch')
const plural = (n, one, many) => (n > 1 ? many : one)

function checkShipped(c, i) {
  const f = c.facts.get(i.number)
  const done = Boolean(f.last?.done)
  if (done && f.last.release) {
    const merged = Boolean(f.last.pr) && c.pulls.has(f.last.pr)
    const pr = f.last.pr ? `; PR {#${f.last.pr}} is ${merged ? 'merged' : 'not in the merged list'}` : ''
    if (merged) c.add('shipped', [i.number], `${ref(i.number)}: the last HANDOFF says done and has RELEASE${pr}.`, 'Read the HANDOFF, check its Done section, then close as completed.', 'allowed')
    else c.add('shipped', [i.number], `${ref(i.number)}: the last HANDOFF says done and has RELEASE${pr}.`, 'Read the HANDOFF; close only when its PR is merged.')
  } else if (!c.loaded(i) && c.marked('release', i)) {
    c.add('shipped', [i.number], `${ref(i.number)}: a comment has RELEASE, comments not loaded.`, 'Read its comments; a HANDOFF that is not "done" keeps the issue open.')
  }
  const named = c.prsNaming(i.number)
  if (named.length && !done) {
    c.add('shipped', [i.number, ...named], `${ref(i.number)}: merged ${plural(named.length, 'PR', 'PRs')} ${refs(named)} ${plural(named.length, 'names', 'name')} it, and no done HANDOFF exists.`,
      'Read the PRs and the issue; close it, or write in the issue what is left.')
  }
}

// One epic: the same parent, or, only when neither has a parent, the same title prefix. Two different parents never match.
function sameEpic(x, y) {
  if (x.parent !== null || y.parent !== null) return x.parent === y.parent
  const px = taskId(x)?.prefix
  return Boolean(px) && px === taskId(y)?.prefix
}

// Nothing has started on the issue: its comments are loaded and show no CLAIM or HANDOFF, and no PR names it.
function untouched(c, i) {
  const f = c.facts.get(i.number)
  return Boolean(c.loaded(i)) && !c.marked('claim', i) && !f.claim && !f.handoffs.length && !c.prsNaming(i.number).length && !c.hasOpenPr(i)
}

function checkPair(c, x, y) {
  const same = x.title.trim().toLowerCase() === y.title.trim().toLowerCase()
  const ix = taskId(x)
  const sameId = Boolean(ix) && ix.id === taskId(y)?.id && c.scope(x) !== null && c.scope(x) === c.scope(y)
  if (same) {
    const act = sameEpic(x, y) && untouched(c, y) ? 'allowed' : 'dispatcher'
    c.add('duplicate', [x.number, y.number], `${ref(x.number)} and ${ref(y.number)} have the same title.`, `Read both; if the bodies match, close {#${y.number}} as a duplicate of {#${x.number}} with a comment.`, act)
  } else if (sameId) {
    c.add('duplicate', [x.number, y.number], `${ref(x.number)} and ${ref(y.number)} have the same task id \`${ix.id}\`.`, `Read both; if the bodies match, close {#${y.number}} as a duplicate of {#${x.number}} with a comment.`)
  } else if (similarity(x.title, y.title) >= SIMILAR_TITLE) {
    c.add('similar', [x.number, y.number], `${ref(x.number)} and ${ref(y.number)} have near-same titles.`, 'Read both; close the newer as a duplicate only if it is the same work.')
  }
}

// Inside one epic, shared names are the planned order; across epics, a shared rare name is an overlap.
function checkOverlap(c, tasks) {
  const named = new Map(tasks.map((i) => [i.number, names(i.body, c.knownTables)]))
  const count = new Map()
  for (const list of named.values()) for (const n of list) count.set(n, (count.get(n) || 0) + 1)
  for (let a = 0; a < tasks.length; a++) {
    for (let b = a + 1; b < tasks.length; b++) {
      const [x, y] = [tasks[a], tasks[b]]
      const shared = named.get(x.number).filter((n) => count.get(n) <= RARE_NAME_MAX && named.get(y.number).includes(n))
      if (c.scope(x) === c.scope(y) || !shared.length) continue
      const linked = c.deps.get(y.number).refs.includes(x.number) || c.deps.get(x.number).refs.includes(y.number)
      c.add('overlap', [x.number, y.number], `${ref(x.number)} and ${ref(y.number)} are in different epics and both name ${shared.map((s) => `\`${s}\``).join(', ')}${linked ? '; one depends on the other' : ''}.`,
        'Dispatcher decides: keep both in this order, merge them, or close one.')
    }
  }
}

function checkRefs(c, i, d) {
  for (const n of d.refs) {
    const dep = c.byNum.get(n)
    if (!dep && c.pulls.has(n)) c.add('dependency', [i.number, n], `${ref(i.number)} depends on ${ref(n)}, which is a pull request.`, 'Write "PR #n" so the dispatcher does not wait for an issue.')
    else if (!dep) c.add('dependency', [i.number, n], `${ref(i.number)} depends on ${ref(n)}, which is not in the issue list.`, 'Check the number and fix the "Depends on" line.')
    else if (dep.state === 'closed' && ['not_planned', 'duplicate'].includes(dep.stateReason)) {
      c.add('dependency', [i.number, n], `${ref(i.number)} depends on ${ref(n)}, closed as ${dep.stateReason.replace('_', ' ')}.`, 'Replace or drop that dependency.')
    }
  }
}

const scopeOf = (i) => i.parent ?? taskId(i)?.prefix ?? null

/** The one issue a bare task id ("M5") names in the same epic (sameEpic); null when none or several. */
export function resolveTaskId(all, i, id) {
  const hits = all.filter((x) => x.number !== i.number && taskId(x)?.id === id && sameEpic(x, i))
  return hits.length === 1 ? hits[0].number : null
}

function checkMissing(c, i, d) {
  for (const id of d.named) {
    const n = resolveTaskId(c.all, i, id)
    if (n !== null && !d.refs.includes(n)) {
      c.add('missing-dependency', [i.number, n], `${ref(i.number)} names \`${id}\` in "Depends on" without its number.`, `Add \`Depends on: #${n}\`.`, 'allowed')
    }
  }
  for (const n of d.before) {
    if (c.byNum.get(n)?.state !== 'open' || c.deps.get(n).refs.includes(i.number) || d.refs.includes(n)) continue
    c.add('missing-dependency', [n, i.number], `${ref(i.number)} says it goes before ${ref(n)}, and {#${n}} has no \`Depends on: #${i.number}\` line.`, `Add \`Depends on: #${i.number}\` to {#${n}}.`, 'allowed')
  }
}

function checkDependencies(c) {
  const waiting = []
  for (const i of c.open) {
    const d = c.deps.get(i.number)
    checkRefs(c, i, d)
    checkMissing(c, i, d)
    const openDeps = d.refs.filter((n) => c.byNum.get(n)?.state === 'open')
    if (!openDeps.length) continue
    const claim = c.facts.get(i.number).claim
    if (claim && !claim.released) c.add('dependency', [i.number, ...openDeps], `${ref(i.number)} is claimed while it depends on open ${refs(openDeps)}.`, 'Check the claim; the task should wait.')
    else if (has(i, 'task') && !has(i, 'held') && !has(i, 'owner')) waiting.push(i.number)
  }
  if (waiting.length) c.add('waiting', waiting, `${waiting.length} tasks without held wait for open dependencies; the dispatcher skips them until those close.`, 'None.')
}

function checkCycles(c) {
  const openSet = new Set(c.open.map((i) => i.number))
  const color = new Map()
  const visit = (n, path) => {
    color.set(n, 1)
    for (const m of c.deps.get(n).refs.filter((x) => openSet.has(x))) {
      if (color.get(m) === 1) {
        const cycle = path.slice(path.indexOf(m)).concat(m)
        c.add('cycle', cycle.slice(0, -1), `Dependency cycle: ${cycle.map(ref).join(' -> ')}.`, 'Read the tasks and remove the wrong "Depends on" line.')
      } else if (!color.get(m)) visit(m, path.concat(m))
    }
    color.set(n, 2)
  }
  for (const n of openSet) if (!color.get(n)) visit(n, [n])
}

function checkLabels(c, i) {
  if (!i.labels.length) {
    let label = null
    if (i.subIssues > 0) label = 'epic'
    else if (i.parent) label = 'task'
    if (label) c.add('labels', [i.number], `${ref(i.number)} has no label.`, `Add the label \`${label}\`.`, 'allowed')
    else c.add('labels', [i.number], `${ref(i.number)} has no label.`, 'Ask the dispatcher which epic it belongs to.')
  } else if (i.subIssues > 0 && !has(i, 'epic')) c.add('labels', [i.number], `${ref(i.number)} has sub-issues but no \`epic\` label.`, 'Add the label `epic`.', 'allowed')
  if (has(i, 'task') && !i.parent && !has(i, 'cleanup') && !has(i, 'weekly')) c.add('orphan', [i.number], `${ref(i.number)} is a task with no parent epic.`, 'Add it to its epic as a sub-issue (the dispatcher picks the epic).')
  if (has(i, 'held') || has(i, 'owner') || !/Label `held`|^## Held/m.test(i.body)) return
  if (OWNER_QUESTION.test(i.body)) {
    c.add('labels', [i.number], `${ref(i.number)}: the body says \`held\` but the label is gone; the body still names an owner question.`, 'Check the answer is recorded in the epic; if not, ask the owner.', 'owner')
  } else c.add('labels', [i.number], `${ref(i.number)}: the body says \`held\` but the label is gone.`, 'None if the owner approved the start; else add `held` back.')
}

function checkStale(c, i) {
  const days = (c.now - Date.parse(i.updatedAt)) / 86400000
  if (days > c.staleDays) c.add('stale', [i.number], `${ref(i.number)}: no activity for ${Math.floor(days)} days.`, 'Check it is still wanted; close only finished or replaced work.')
  const claim = c.facts.get(i.number).claim
  if (claim && !claim.released && (c.now - Date.parse(claim.heartbeat)) / 3600000 > CLAIM_STALE_HOURS) {
    c.add('claim', [i.number], `${ref(i.number)}: the CLAIM heartbeat is older than ${CLAIM_STALE_HOURS} hours and has no RELEASE.`, 'Dispatcher watchdog: check the session, then resume or release.')
  } else if (!c.loaded(i) && c.marked('claim', i)) {
    c.add('claim', [i.number], `${ref(i.number)} has a CLAIM comment; comments not loaded.`, 'Load its comments to check the heartbeat.')
  }
  const text = [i.body, ...(c.loaded(i) || []).map((x) => x.body || '')].join('\n')
  if (!(has(i, 'held') || has(i, 'owner')) || has(i, 'parked') || isEpic(i) || OWNER_QUESTION.test(text)) return
  const waitsFor = c.deps.get(i.number).refs.filter((n) => c.byNum.get(n)?.state === 'open')
  const tags = i.labels.filter((l) => l === 'held' || l === 'owner').map((l) => `\`${l}\``).join(' and ')
  if (waitsFor.length) c.add('held', [i.number], `${ref(i.number)} is labelled ${tags} and names no owner question; it waits for open ${refs(waitsFor)}.`, 'None; the dispatcher removes `held` when those close.')
  else c.add('held', [i.number], `${ref(i.number)} is labelled ${tags} and names no owner question.`, 'Say in the issue what it waits for.')
}

/** Every check. Returns findings: { kind, issues, what, fix, act } with act = allowed | dispatcher | owner. */
export function analyze(snapshot, { today = new Date().toISOString(), staleDays = STALE_DAYS, knownTables = [] } = {}) {
  const all = (snapshot.issues || []).map(normalize)
  const open = all.filter((i) => i.state === 'open').sort((a, b) => a.number - b.number)
  const comments = snapshot.comments || {}
  const markers = snapshot.markers || {}
  const out = []
  const c = {
    all,
    open,
    knownTables,
    staleDays,
    now: Date.parse(today),
    byNum: new Map(all.map((i) => [i.number, i])),
    pulls: new Map((snapshot.pulls || []).map((p) => [p.number, p])),
    deps: new Map(open.map((i) => [i.number, dependencies(i.body)])),
    loaded: (i) => comments[i.number] || comments[String(i.number)],
    marked: (kind, i) => (markers[kind] || []).includes(i.number),
    // Unknown (a snapshot without open_pulls) counts as having one. A comment that links a PR counts too.
    hasOpenPr: (i) => !Array.isArray(snapshot.open_pulls) || snapshot.open_pulls.some((p) => new RegExp(`#${i.number}\\b`).test(`${p.title}\n${p.body || ''}`))
      || (c.loaded(i) || []).some((x) => /\bPR #\d+|\/pull\/\d+/.test(x.body || '')),
    // Merged PRs whose title or body says "Closes", "Fixes", "Resolves" or "Implements #n".
    prsNaming: (n) => [...(snapshot.pulls || [])].filter((p) => new RegExp(`\\b(closes|fixes|resolves|implements)\\s+#${n}\\b`, 'i').test(`${p.title}\n${p.body || ''}`)).map((p) => p.number).sort((a, b) => a - b),
    scope: scopeOf,
    add: (kind, issues, what, fix, act = 'dispatcher') => out.push({ kind, issues, what, fix, act })
  }
  const owner = String(snapshot.repo || REPO).split('/')[0]
  c.facts = new Map(open.map((i) => [i.number, commentFacts(c.loaded(i), { owner })]))
  const tasks = open.filter((i) => !isEpic(i))
  for (const i of tasks) checkShipped(c, i)
  for (let a = 0; a < tasks.length; a++) for (let b = a + 1; b < tasks.length; b++) checkPair(c, tasks[a], tasks[b])
  checkOverlap(c, tasks)
  checkDependencies(c)
  checkCycles(c)
  for (const i of open) {
    checkStale(c, i)
    checkLabels(c, i)
  }
  for (const i of open.filter((x) => x.subIssues >= NEAR_LIMIT)) {
    c.add('limit', [i.number], `${ref(i.number)} has ${i.subIssues} of ${SUB_ISSUE_LIMIT} sub-issues.`, i.subIssues >= SUB_ISSUE_LIMIT ? 'New tasks go to the follow-up epic.' : 'Plan a follow-up epic.')
  }
  return out
}

/** A valid order of the open tasks: dependencies (numbers and resolved task ids) and "goes before" first, then by number. Tasks in a cycle are left out. */
export function order(snapshot) {
  const all = (snapshot.issues || []).map(normalize)
  const open = all.filter((i) => i.state === 'open' && i.labels.includes('task'))
  const set = new Set(open.map((i) => i.number))
  const parsed = new Map(open.map((i) => [i.number, dependencies(i.body)]))
  // Numbers, plus task ids that name exactly one issue ("Depends on: M5").
  const edges = (i) => [...parsed.get(i.number).refs, ...parsed.get(i.number).named.map((id) => resolveTaskId(all, i, id))]
  // A self-dependency stays in, so that task and the ones after it are left out like any other cycle.
  const need = new Map(open.map((i) => [i.number, [...new Set(edges(i))].filter((n) => set.has(n))]))
  // "Goes before #n" on task a means #n waits for a.
  for (const [a, d] of parsed) for (const n of d.before) if (set.has(n) && n !== a && !need.get(n).includes(a)) need.get(n).push(a)
  const done = new Set()
  const result = []
  let progress = true
  while (progress) {
    progress = false
    for (const n of [...set].sort((a, b) => a - b)) {
      if (done.has(n) || need.get(n).some((m) => !done.has(m))) continue
      done.add(n)
      result.push(n)
      progress = true
    }
  }
  return { order: result, left: [...set].filter((n) => !done.has(n)).sort((a, b) => a - b) }
}

const SECTIONS = [
  ['Shipped but open', ['shipped']],
  ['Duplicates and overlap', ['duplicate', 'similar', 'overlap']],
  ['Dependencies', ['dependency', 'missing-dependency', 'cycle', 'waiting']],
  ['Stale and orphaned', ['stale', 'orphan', 'claim', 'held']],
  ['Limits', ['limit']],
  ['Labels', ['labels']]
]

/** 3 to 6 words for every issue and merged pull request in the snapshot, keyed by number. */
export function describeAll(snapshot) {
  const names = new Map()
  for (const p of snapshot.pulls || []) names.set(p.number, shortName({ title: p.title || '' }))
  for (const i of snapshot.issues || []) names.set(i.number, shortName({ title: i.title || '' }))
  return names
}

/** Replaces each {#n} with "#n (words)" the first time and "#n" after, as the reply-style lint asks. */
export function expand(text, names, seen) {
  return text.replace(/\{#(\d+)\}/g, (_, n) => {
    const k = Number(n)
    if (seen.has(k)) return `#${k}`
    seen.add(k)
    return `#${k} (${names.get(k) || 'not in the issue list'})`
  })
}

/** Splits a line after ", " or "; " so no line is over `max` characters; later lines are indented 2 more spaces. */
export function wrap(line, max = 150) {
  if (line.length <= max) return [line]
  const indent = ' '.repeat(line.search(/\S|$/) + 2)
  const out = []
  let rest = line
  while (rest.length > max) {
    const cut = Math.max(rest.lastIndexOf(', ', max), rest.lastIndexOf('; ', max))
    if (cut <= indent.length) break
    out.push(rest.slice(0, cut + 1))
    rest = indent + rest.slice(cut + 2)
  }
  return out.concat(rest)
}

/** The report text: one line per finding and its fix below it, grouped, then the valid order in a code block. */
export function formatReport(findings, { openCount, today, orderResult, names = new Map() } = {}) {
  const seen = new Set()
  const lines = [`Task janitor report, ${String(today).slice(0, 10)}: ${openCount} open issues read, ${findings.length} findings. Read-only: nothing applied.`, '']
  lines.push('Each fix ends with who acts: `allowed` (the agent may apply it), `dispatcher` or `owner`.', '')
  for (const [title, kinds] of SECTIONS) {
    const list = findings.filter((f) => kinds.includes(f.kind))
    lines.push(`### ${title}`)
    if (!list.length) lines.push('- None found.')
    for (const f of list) lines.push(...wrap(`- ${expand(f.what, names, seen)}`), ...wrap(`  Fix: ${expand(f.fix, names, seen)} \`${f.act}\``))
    lines.push('')
  }
  if (orderResult) {
    lines.push('### Valid order of open tasks', '```text')
    for (let k = 0; k < orderResult.order.length; k += 15) lines.push(orderResult.order.slice(k, k + 15).map((n) => `#${n}`).join(' '))
    if (orderResult.left.length) lines.push(`In a cycle or waiting on one, left out: ${orderResult.left.map((n) => `#${n}`).join(' ')}`)
    lines.push('```')
  }
  return lines.join('\n') + '\n'
}

/** Table names from the repo's migrations, so a backticked `drafts` counts as a table. */
export function migrationTables(dir = 'db/migrations') {
  const tables = new Set()
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql'))) {
    for (const m of readFileSync(`${dir}/${f}`, 'utf8').matchAll(/create table(?: if not exists)?\s+"?(\w+)"?/gi)) tables.add(m[1].toLowerCase())
  }
  return [...tables]
}

function search(q, run) {
  const text = run(['api', '-X', 'GET', 'search/issues', '-f', `q=${q}`, '-f', 'per_page=100', '--paginate', '--jq', '.items[]'])
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

/** Builds a snapshot with gh search only. `run` is injectable for tests. */
export function fetchSnapshot({ repo = REPO, run = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 << 20 }) } = {}) {
  const r = `repo:${repo}`
  const issues = [...search(`${r} is:issue is:open`, run), ...search(`${r} is:issue is:closed`, run)]
  const pulls = search(`${r} is:pr is:merged`, run).map((p) => ({ number: p.number, title: p.title, body: p.body || '', merged_at: p.pull_request?.merged_at }))
  const openPulls = search(`${r} is:pr is:open`, run).map((p) => ({ number: p.number, title: p.title, body: p.body || '' }))
  const mark = (word) => search(`${r} is:issue is:open ${word} in:comments`, run).map((i) => i.number)
  return { fetched_at: new Date().toISOString(), repo, issues, pulls, open_pulls: openPulls, markers: { release: mark('RELEASE'), claim: mark('CLAIM') }, comments: {} }
}

function main() {
  const [cmd, file, ...rest] = process.argv.slice(2)
  const opt = (name) => { const k = rest.indexOf(name); return k === -1 ? null : rest[k + 1] }
  if (cmd === 'fetch') {
    process.stdout.write(JSON.stringify(fetchSnapshot(), null, 1) + '\n')
    return
  }
  if (cmd !== 'report' || !file) {
    console.error('usage: janitor.mjs fetch > snapshot.json | janitor.mjs report snapshot.json [--comments f] [--today YYYY-MM-DD] [--stale-days N]')
    process.exit(2)
  }
  const snapshot = JSON.parse(readFileSync(file, 'utf8'))
  if (opt('--comments')) snapshot.comments = { ...snapshot.comments, ...JSON.parse(readFileSync(opt('--comments'), 'utf8')) }
  const today = opt('--today') ? `${opt('--today')}T23:59:59Z` : snapshot.fetched_at || new Date().toISOString()
  const findings = analyze(snapshot, { today, staleDays: Number(opt('--stale-days') || STALE_DAYS), knownTables: migrationTables() })
  const openCount = snapshot.issues.filter((i) => String(i.state).toLowerCase() === 'open').length
  process.stdout.write(formatReport(findings, { openCount, today, orderResult: order(snapshot), names: describeAll(snapshot) }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
