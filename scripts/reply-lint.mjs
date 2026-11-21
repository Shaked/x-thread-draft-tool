#!/usr/bin/env node
// Reply lint: checks one reply to the owner (a chat reply, a HANDOFF, an owner question) against
// the hard rules of the reply-style skill, `.claude/skills/reply-style/SKILL.md`. No network.
//
// Usage: node scripts/reply-lint.mjs [--template] <file>   (or pipe the reply on stdin)
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
//   tldr, steps     TL;DR is 2 to 3 lines and says if the owner must act; the step count matches
//   evidence        the Done section says "checked" or "not checked"
// Fenced code blocks and `inline code` are not checked.

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

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
const EMOJI = /\p{Extended_Pictographic}/u
const SLOP = /\b(delve[sd]?|seamless(?:ly)?|leverag(?:e|es|ed|ing)|game[- ]changer|rest assured|it'?s worth noting|i hope this helps|great question|needless to say|in conclusion)\b/i
const ACT = /\b(Nothing needed from you|You need to do (\d+|one|two|three|four|five) things?)\b/i
const NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5 }

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

function checkTemplate(lines, force, add) {
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
  const done = all[at[4]]
  if (done && !/\bchecked\b/i.test(done.body.join(' '))) add(done.line, 'evidence', 'say "checked" or "not checked"')
}

/** Returns findings for one reply: [{ line, rule, message }]. */
export function lint(text, { template = false } = {}) {
  const findings = []
  const add = (line, rule, message) => findings.push({ line, rule, message })
  const seen = new Set()
  const prose = []
  let fenced = false
  text.split('\n').forEach((raw, i) => {
    const n = i + 1
    if (/^\s*(```|~~~)/.test(raw)) { fenced = !fenced; return }
    if (fenced) return
    prose.push({ text: raw, n })
    const line = visible(raw)
    for (const m of line.matchAll(LABEL)) {
      if (seen.has(m[1])) continue
      seen.add(m[1])
      if (!described(line, m.index, m.index + m[0].length)) add(n, 'bare-label', `${m[1]}: add a link and 3 to 6 words saying what it is`)
    }
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
    if (EMOJI.test(line)) add(n, 'emoji', 'no emoji')
    const slop = SLOP.exec(line)
    if (slop) add(n, 'slop', `filler phrase "${slop[1]}"`)
  })
  checkTemplate(prose, template, add)
  return findings.sort((a, b) => a.line - b.line)
}

function main() {
  const args = process.argv.slice(2)
  const template = args.includes('--template')
  const file = args.find((a) => a !== '--template')
  const text = readFileSync(file ?? 0, 'utf8')
  const findings = lint(text, { template })
  for (const f of findings) console.log(`line ${f.line}: ${f.rule}: ${f.message}`)
  console.log(findings.length ? `reply-lint: ${findings.length} finding(s)` : 'reply-lint: OK')
  if (findings.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
