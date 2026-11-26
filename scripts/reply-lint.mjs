#!/usr/bin/env node
// Reply lint: checks one reply to the owner (a chat reply, a HANDOFF, an owner question) against
// the hard rules of the reply-style skill, `.claude/skills/reply-style/SKILL.md`. No network.
//
// Usage: node scripts/reply-lint.mjs [--template] [--kind=changelog|telegram] <file>   (or stdin)
// Exits 1 when anything is found. Each finding prints `line N: rule: message`.
//
// Rules:
//   bare-label      the first mention of a label (#273, Q1, T7, S2) has no 3 to 6 words saying what it is
//   option-letters  options named by letters only (A, B or C; **A:**; reply "A"; (a) and (b))
//   unchanged       "unchanged" or "still open": say what it is and what happens next
//   blocked         "blocked" not followed by "on you" or "on Shaked": only a human blocks
//   waiting-human   "waiting on you": a human is "Blocked on you", not "waiting for"
//   long-line       a line over 160 visible characters (a link counts as its text)
//   emoji, slop     any emoji; a filler phrase from SLOP
//   headings        a templated reply misses a fixed heading, or has them out of order
//   loose-label     a bold or plain "Done:", "Blocked on you:" ... line used instead of its "## " heading (#486)
//   empty-details   a "## Details" heading with nothing under it: leave the heading out (#486)
//   tldr, steps     TL;DR is 2 to 3 lines and says if the owner must act; the step count matches
//   session-link    a "Waiting for" item that names a session (the word or a session id) has no session link
//   evidence        the Done section says "checked" or "not checked"
//   --kind=changelog: a "# " title, then 1 to 5 lines; no label and no code span anywhere (shape, internal-label)
//   --kind=telegram:  line 1 is the emoji, the app name in bold, " · " and the headline; at most 5 lines (shape).
//                     A message without the app name fails (issue #504). `--app=<name>` also requires that exact name.
// Fenced code blocks and `inline code` are not checked.

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** Every rule name the lint reports. A test fails when one has no failing fixture or is missing from the skill's "Before you send" list. */
export const RULES = [
  'bare-label', 'option-letters', 'unchanged', 'blocked', 'waiting-human', 'long-line', 'emoji', 'slop', 'headings', 'loose-label',
  'empty-details', 'tldr', 'steps', 'session-link', 'evidence', 'internal-label', 'shape', 'app-name', 'empty-section'
]
export const HEADINGS = ['TL;DR', 'What you need to do', 'Waiting for', 'Blocked on you', 'Done']
const MAX_LINE = 160
const LABEL = /(?<![\w#/])(#\d+|[A-Z]\d+(?:\.\d+)?)(?!\w)/g
const IS_LABEL = /^(#\d+|[A-Z]\d+(?:\.\d+)?)$/
// Checked on the raw line with quotes and backticks around one capital letter removed.
const OPTION_LETTERS = [
  /(?<![\w/])[A-Z](?:\s*(?:\/|,|\bor\b|\band\b)\s*[A-Z])+(?![\w/])/, // A, B or C; A/B/C; "A" or "B"
  /\b[Oo]ption [A-Z]\b/,
  /\*\*[A-Z](?:\s*\([^)]*\))?\s*:?\*\*/, // **A (recommended):** and **B:**
  /\b(?:[Rr]eply|[Aa]nswer|[Tt]ype|[Pp]ick|[Cc]hoose)\s+[A-Z](?![\w'])/, // reply "A"
  /(?:^|\s)\([a-h]\)\s/ // (a) Allow zoom
]
const UNCHANGED = /\b(unchanged|still open)\b/i
const BLOCK_WORD = /\bblock(?:ed|ing|er|ers|s)?\b/gi
const BLOCK_ON_HUMAN = /^\s+(?:on|by)\s+(?:you|your|Shaked|the owner)\b/i
const WAITING_HUMAN = /\bwaiting\s+(?:on|for)\s*:?\s+(?:you|your|Shaked|the owner)\b/i
// A fixed heading (or a common stand-in such as "Not done") written as a label line instead of a "## " heading.
const LOOSE_LABEL = /^\s*(?:(?:[-*+>]|\d+\.)\s+)*(?:\*\*|__|\*|_)?(?:TL;DR|What you need to do|Waiting for|Blocked on you|Blocked|Not done|Done|Details)(?:\s*:(?:\*\*|__|\*|_)?|(?:\*\*|__|\*|_)\s*:?)(?:\s|$)/i
const EMOJI = /\p{Extended_Pictographic}/u
/** A section line that only says there is nothing: "Nothing needed.", "None", "Waiting for: nothing". Telegram messages never have one. */
export const EMPTY_SECTION = /^(?:[^:]{0,40}:\s*)?(?:nothing(?: needed)?(?: from you)?|none|n\/a)\.?$/i
const SLOP = /\b(delve[sd]?|seamless(?:ly)?|leverag(?:e|es|ed|ing)|game[- ]changer|rest assured|it'?s worth noting|i hope this helps|great question|needless to say|in conclusion)\b/i
const ACT = /\b(Nothing needed from you|You need to do (\d+|one|two|three|four|five) things?)\b/i
const NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5 }
// The one word of `Area:` in a changelog entry (plan #369, step 1). Changing it changes the page groups.
export const AREAS = ['Drafts', 'Editor', 'AI apps', 'Admin', 'Design', 'Speed', 'Security', 'Docs']
// A session link has the shape the commit attribution uses: https://claude.ai/code/session_<id>. Opening it is not checked.
const SESSION_LINK = /\]\(https:\/\/claude\.ai\/code\/session_[\w-]+\)/
const SESSION_WORD = /\bsessions?\b|\bsession_\w+/i
const DETAILS_HEADING = /^## Technical details\s*$/

/** Word count of a description, labels and punctuation left out. */
function words(text) {
  return text.split(/\s+/).map((w) => w.replace(/^[^\w#]+|[^\w]+$/g, '')).filter((w) => w && !IS_LABEL.test(w)).length
}
const enough = (text) => { const n = words(text); return n >= 3 && n <= 6 }

/** True when the label at [start, end) of a visible line has 3 to 6 words saying what it is. */
function described(line, start, end) {
  const open = line.lastIndexOf('⟦', start)
  if (open !== -1 && line.lastIndexOf('⟧', start) < open) {
    const close = line.indexOf('⟧', end)
    if (enough(line.slice(open + 1, close))) return true
    end = close + 1
  }
  const paren = /^\s*\(([^)]*)\)/.exec(line.slice(end))
  return Boolean(paren && enough(paren[1]))
}

/** The line as a reader sees it: no inline code, a link as its text inside marks, no bare URLs. */
function visible(line) {
  return line
    .replace(/`[^`]*`/g, '‹›')
    .replace(/\[([^\]]*)\]\([^)\s]*\)/g, '⟦$1⟧')
    .replace(/https?:\/\/\S+/g, 'link')
}

/** Returns the `##` sections: { name, line, body: [text lines, `###` lines included] } in reply order. */
function sections(lines) {
  const found = []
  lines.forEach(({ text, n }) => {
    const h = /^##\s+(.*?)\s*$/.exec(text)
    if (h) found.push({ name: h[1], line: n, body: [] })
    else if (found.length && text.trim()) found[found.length - 1].body.push(text)
  })
  return found
}

/** A "## Details" heading with nothing under it (no text and no fenced block) is left out. */
function checkDetails(all, fencedLines, add) {
  const details = all.find((s) => s.name.toLowerCase() === 'details')
  if (!details || details.body.length) return
  const next = all.find((s) => s.line > details.line)?.line ?? Infinity
  if (!fencedLines.some((n) => n > details.line && n < next)) add(details.line, 'empty-details', 'leave out the "Details" heading when it is empty')
}

/** Each "Waiting for" item (a "- " line and its continuation lines) that names a session carries a session link. */
function checkWaitingSessions(waiting, add) {
  if (!waiting) return
  const items = []
  waiting.body.forEach((t) => {
    if (/^\s*[-*+]\s/.test(t) || !items.length) items.push([])
    items[items.length - 1].push(t)
  })
  for (const item of items) {
    const raw = item.join(' ')
    if (SESSION_WORD.test(raw.replace(/\[([^\]]*)\]\([^)\s]*\)/g, '$1')) && !SESSION_LINK.test(raw)) {
      add(waiting.line, 'session-link', `"${item[0].trim().slice(0, 50)}" names a session: add its session link next to the task link, [session](https://claude.ai/code/session_<id>)`)
    }
  }
}

function checkTemplate(lines, force, add, fencedLines = []) {
  const all = sections(lines)
  const find = (name) => all.findIndex((s) => s.name.toLowerCase() === name.toLowerCase())
  const at = HEADINGS.map(find)
  if (!force && at.every((i) => i === -1)) return
  let last = -1
  HEADINGS.forEach((name, k) => {
    if (at[k] === -1) add(1, 'headings', `missing the heading "${name}"`)
    else if (at[k] < last) add(all[at[k]].line, 'headings', `"${name}" is out of order`)
    else last = at[k]
  })
  const tldr = all[at[0]]
  if (tldr) {
    const act = ACT.exec(tldr.body.join(' '))
    if (tldr.body.length < 2 || tldr.body.length > 3) add(tldr.line, 'tldr', 'TL;DR must be 2 to 3 lines')
    if (!act) add(tldr.line, 'tldr', 'TL;DR must say "Nothing needed from you" or "You need to do N things"')
    const actions = all[at[1]]
    if (act && actions) {
      const steps = actions.body.filter((t) => /^ ?\d+\.\s/.test(t)).length
      const want = act[2] ? Number(act[2]) || NUMBERS[act[2].toLowerCase()] : 0
      if (want === 0 && !/^nothing\b/i.test(actions.body[0] || '')) add(actions.line, 'steps', 'write "Nothing" when nothing is needed')
      if (want > 0 && steps !== want) add(actions.line, 'steps', `TL;DR says ${want}, the list has ${steps} numbered steps`)
    }
  }
  checkDetails(all, fencedLines, add)
  checkWaitingSessions(all[at[2]], add)
  const done = all[at[4]]
  if (done && !/\bchecked\b/i.test(done.body.join(' '))) add(done.line, 'evidence', 'say "checked" or "not checked"')
}

/** The word and line checks every kind gets. */
function checkWords(raw, line, n, add, kind = 'reply', headlineAt = 1) {
  const unquoted = raw.replace(/["'`]([A-Z])["'`]/g, '$1')
  if (OPTION_LETTERS.some((re) => re.test(unquoted))) add(n, 'option-letters', 'name each option by what it does, not by a letter')
  if (UNCHANGED.test(line)) add(n, 'unchanged', 'say what it is and what happens next')
  for (const m of line.matchAll(BLOCK_WORD)) {
    const before = line.slice(0, m.index)
    if (/\bcode\s+$/i.test(before) || BLOCK_ON_HUMAN.test(line.slice(m.index + m[0].length))) continue
    add(n, 'blocked', 'only a human blocks: write "Blocked on you", or "waiting for" an agent or system')
  }
  if (WAITING_HUMAN.test(line)) add(n, 'waiting-human', 'a human decision goes under "Blocked on you"')
  if (!/^\s*\|/.test(raw) && raw.replace(/\[([^\]]*)\]\([^)\s]*\)/g, '$1').replace(/https?:\/\/\S+/g, 'link').length > MAX_LINE) add(n, 'long-line', `over ${MAX_LINE} characters`)
  // A Telegram headline (line 1) starts with one emoji; every other line and kind has none.
  const headlineEmoji = kind === 'telegram' && n === headlineAt && /^\p{Extended_Pictographic}\uFE0F? \S/u.test(line) && !EMOJI.test(line.replace(/^\p{Extended_Pictographic}\uFE0F?/u, ''))
  if (EMOJI.test(line) && !headlineEmoji) add(n, 'emoji', kind === 'telegram' ? 'one emoji, at the start of the headline only' : 'no emoji')
  if (kind === 'telegram' && EMPTY_SECTION.test(line.trim())) add(n, 'empty-section', 'leave out a section with nothing to say')
  const slop = SLOP.exec(line)
  if (slop) add(n, 'slop', `filler phrase "${slop[1]}"`)
}

/** Line 1 of a Telegram message: the emoji, the app name in bold, " · " and the headline (issue #504). */
function checkIdentity(first, add, app) {
  const identity = first.match(/^(?:\p{Extended_Pictographic}\uFE0F? )?\*\*([^*]+)\*\* · \S/u)
  if (!identity) add(1, 'app-name', 'line 1 is the emoji, the app name in bold, " · " and the headline')
  else if (!/^\p{Extended_Pictographic}/u.test(first)) add(1, 'shape', 'the headline starts with its emoji')
  else if (app && identity[1] !== app) add(1, 'app-name', `the app name in bold must be "${app}"`)
}

/** Shape of a changelog entry or a Telegram message (the two kinds that are not replies). */
function checkShape(lines, kind, add, app = '') {
  const body = lines.filter(({ text }) => text.trim())
  const first = body[0]?.text.trim() || ''
  if (kind === 'changelog') {
    if (!/^# \S/.test(first)) add(1, 'shape', 'start with one "# " title that says what changed for a person')
    const fields = (name) => body.filter(({ text }) => text.trim().startsWith(`${name}:`))
    const text = body.slice(1).filter(({ text }) => !/^(Area|Link):/.test(text.trim()))
    if (text.length < 1 || text.length > 5) add(1, 'shape', 'write 1 to 5 short lines under the title')
    const area = fields('Area')
    if (area.length !== 1) add(area[1]?.n ?? 1, 'shape', 'write one "Area:" line')
    else if (!AREAS.includes(area[0].text.trim().slice('Area:'.length).trim())) add(area[0].n, 'shape', `Area must be one of: ${AREAS.join(', ')}`)
    const link = fields('Link')
    if (link.length !== 1) add(link[1]?.n ?? 1, 'shape', 'write one "Link:" line with the pull request address')
    else if (!/^Link: https:\/\/\S+$/.test(link[0].text.trim())) add(link[0].n, 'shape', 'Link must start with https://')
  } else {
    checkIdentity(first, add, app)
    if (body.length > 5) add(1, 'shape', 'a Telegram message has at most 5 lines')
  }
}

/** Returns findings for one reply: [{ line, rule, message }]. `kind` is reply, changelog or telegram. */
export function lint(text, { template = false, kind = 'reply', app = '' } = {}) {
  const findings = []
  const add = (line, rule, message) => findings.push({ line, rule, message })
  const seen = new Set()
  let headlineAt = 0 // the first non-blank prose line: the Telegram headline
  const prose = []
  let fenced = false
  const fencedLines = [] // fenced content still counts as content when a section is checked for being empty
  let details = false // a changelog's "## Technical details" part is not checked (it may hold code and labels)
  text.split('\n').forEach((raw, i) => {
    const n = i + 1
    if (kind === 'changelog' && DETAILS_HEADING.test(raw)) details = true
    if (details) return
    if (/^\s*(```|~~~)/.test(raw)) { fenced = !fenced; fencedLines.push(n); return }
    if (fenced) { fencedLines.push(n); return }
    prose.push({ text: raw, n })
    if (!headlineAt && raw.trim()) headlineAt = n
    // The net-lines line of a PR body ("Implements #273 Task R0") must stay in that exact form.
    const line = /^Implements #\d+ Task /.test(raw) ? '' : visible(raw)
    if (kind === 'changelog' && (LABEL.test(line) || /`/.test(raw))) add(n, 'internal-label', 'plain words only: no issue numbers, task ids or code')
    LABEL.lastIndex = 0
    for (const m of line.matchAll(LABEL)) {
      if (seen.has(m[1]) || kind === 'changelog') continue
      seen.add(m[1])
      if (!described(line, m.index, m.index + m[0].length)) add(n, 'bare-label', `${m[1]}: add a link and 3 to 6 words saying what it is`)
    }
    if (kind === 'reply' && LOOSE_LABEL.test(raw)) add(n, 'loose-label', 'use the "## " heading from the template (for "Not done" or "Blocked", write a sentence under Done or Blocked on you)')
    checkWords(raw, line, n, add, kind, headlineAt)
  })
  if (kind === 'reply') checkTemplate(prose, template || findings.some((f) => f.rule === 'loose-label'), add, fencedLines)
  else checkShape(prose, kind, add, app)
  return findings.sort((a, b) => a.line - b.line)
}

function main() {
  const args = process.argv.slice(2)
  const template = args.includes('--template')
  const kind = args.find((a) => a.startsWith('--kind='))?.slice(7) || 'reply'
  if (!['reply', 'changelog', 'telegram'].includes(kind)) throw new Error(`unknown --kind=${kind}`)
  const file = args.find((a) => !a.startsWith('--'))
  const text = readFileSync(file ?? 0, 'utf8')
  const app = args.find((a) => a.startsWith('--app='))?.slice(6) || ''
  const findings = lint(text, { template, kind, app })
  for (const f of findings) console.log(`line ${f.line}: ${f.rule}: ${f.message}`)
  console.log(findings.length ? `reply-lint: ${findings.length} finding(s)` : 'reply-lint: OK')
  if (findings.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
