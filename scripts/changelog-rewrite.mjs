#!/usr/bin/env node
// Rewrites old changelog entries to the new shape (plan #369, step 2). A batch file lists the entries to rewrite:
// docs/changelog-rewrites/batch-<NN>.json, a JSON array of { file, pr, area, title, lines }.
// A rewritten entry has the new title, its lines, Area and Link on top, and its whole original text, byte for byte,
// under "## Technical details". Only entries dated from WINDOW_START on can be rewritten. No network.
//
// Usage (run from the repository root):
//   node scripts/changelog-rewrite.mjs [--dry-run] <batch>   prints the plan and writes nothing (the default)
//   node scripts/changelog-rewrite.mjs --write <batch>       writes the files; a second run changes nothing
//   node scripts/changelog-rewrite.mjs --check <batch>       exits 0 only when each file is what --write makes,
//                                                           with the original text taken from the file's history
// Exit codes: 0 ok, 1 a finding (nothing is written), 2 a usage error.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { AREAS, lint } from './reply-lint.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const DIR = 'docs/changelogs/'
export const BATCH_DIR = 'docs/changelog-rewrites/'
export const WINDOW_START = '20261111' // an entry dated before this day is never rewritten
export const MARK = '## Technical details'
const PR_URL = /^https:\/\/github\.com\/Shaked\/x-thread-draft-tool\/pull\/\d+$/

/** Pure: true when the file is an entry under DIR and its UTC date in the name is inside the window. */
export function inWindow(file) {
  const name = basename(file)
  return file.startsWith(DIR) && /^\d{8}-\d{6}-.+\.md$/.test(name) && name.slice(0, 8) >= WINDOW_START
}

/** Pure: the problems with one batch entry's fields (the file's own state is checked elsewhere). */
export function entryProblems(entry) {
  const problems = []
  if (typeof entry.file !== 'string' || !entry.file.startsWith(DIR) || !entry.file.endsWith('.md') || entry.file === `${DIR}README.md`) {
    problems.push(`file must be an entry under ${DIR}`)
  }
  if (typeof entry.pr !== 'string' || !PR_URL.test(entry.pr)) problems.push('pr must be the pull request address (https://github.com/Shaked/x-thread-draft-tool/pull/<n>)')
  if (!AREAS.includes(entry.area)) problems.push(`area must be one of: ${AREAS.join(', ')}`)
  if (typeof entry.title !== 'string' || !entry.title.trim() || entry.title.includes('\n')) problems.push('title must be one line')
  const lines = entry.lines
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 5 || lines.some((line) => typeof line !== 'string' || !line.trim() || line.includes('\n'))) {
    problems.push('lines must be 1 to 5 one-line strings')
  }
  return problems
}

/** Pure: the text of a rewritten entry. `original` follows the heading unchanged. */
export function rewriteText(original, { title, lines, area, pr }) {
  const bullets = lines.map((line) => `- ${line.trim()}`).join('\n')
  return `# ${title.trim()}\n\n${bullets}\n\nArea: ${area}\nLink: ${pr}\n\n${MARK}\n\n${original}`
}

/** Pure: the original text of an entry: the text under the heading once rewritten, else the whole text. */
export function originalOf(text) {
  const at = text.indexOf(`\n${MARK}\n\n`) // the heading starts a line, so a title that mentions it does not match
  return at === -1 ? text : text.slice(at + MARK.length + 3)
}

/** Pure: the first `# ` heading of a text, or '' when none. */
function titleOf(text) {
  return text.match(/^#\s+(.+)$/m)?.[1].trim() ?? ''
}

/** Pure: lint findings for the new text, as `line N: rule: message` strings. */
function lintProblems(text) {
  return lint(text, { kind: 'changelog' }).map((f) => `line ${f.line}: ${f.rule}: ${f.message}`)
}

/**
 * Pure: the plan for one batch. `readFile(file)` gives the current text of an entry, or null when it does not exist.
 * Returns { ok, findings, changes }. `changes` lists { file, from, to, oldTitle, newTitle, lines } for each entry
 * whose text changes. Nothing is written here: a batch with any finding is not applied at all.
 */
export function planBatch(batch, readFile) {
  const findings = []
  const changes = []
  if (!Array.isArray(batch)) return { ok: false, findings: ['the batch must be a JSON array of entries'], changes }
  const files = new Set()
  batch.forEach((entry, i) => {
    const label = typeof entry?.file === 'string' ? entry.file : `entry ${i + 1}`
    const problems = entryProblems(entry ?? {})
    for (const problem of problems) findings.push(`${label}: ${problem}`)
    if (problems.length) return
    if (files.has(entry.file)) return findings.push(`${label}: listed twice in the batch`)
    files.add(entry.file)
    if (!inWindow(entry.file)) return findings.push(`${label}: dated before ${WINDOW_START}, outside the rewrite window`)
    const from = readFile(entry.file)
    if (from === null) return findings.push(`${label}: file not found`)
    const original = originalOf(from)
    const to = rewriteText(original, entry)
    if (from === to) return // already done by an earlier --write of this batch
    if (from.includes(MARK) || /^(Area|Link):/m.test(from)) {
      return findings.push(`${label}: already has the new shape, and differs from this batch`)
    }
    const problemsLint = lintProblems(to)
    for (const problem of problemsLint) findings.push(`${label}: ${problem}`)
    if (problemsLint.length) return
    changes.push({ file: entry.file, from, to, oldTitle: titleOf(from), newTitle: entry.title.trim(), lines: entry.lines })
  })
  return { ok: findings.length === 0, findings, changes }
}

/**
 * Pure: whether each entry of a batch is exactly what --write makes, with `readOriginal(file)` giving the text
 * before the rewrite. Returns { ok, findings }.
 */
export function checkBatch(batch, readFile, readOriginal) {
  const findings = []
  if (!Array.isArray(batch)) return { ok: false, findings: ['the batch must be a JSON array of entries'] }
  const files = new Set()
  batch.forEach((entry, i) => {
    const label = typeof entry?.file === 'string' ? entry.file : `entry ${i + 1}`
    const problems = entryProblems(entry ?? {})
    if (problems.length) return problems.forEach((problem) => findings.push(`${label}: ${problem}`))
    if (files.has(entry.file)) return findings.push(`${label}: listed twice in the batch`)
    files.add(entry.file)
    if (!inWindow(entry.file)) return findings.push(`${label}: dated before ${WINDOW_START}, outside the rewrite window`)
    const current = readFile(entry.file)
    if (current === null) return findings.push(`${label}: file not found`)
    let original
    try {
      original = readOriginal(entry.file)
    } catch (error) {
      return findings.push(`${label}: no original text (${error.message})`)
    }
    const expected = rewriteText(original, entry)
    if (current !== expected) return findings.push(`${label}: the file differs from what --write of this batch makes`)
    for (const problem of lintProblems(expected)) findings.push(`${label}: ${problem}`)
  })
  return { ok: findings.length === 0, findings }
}

/**
 * The text an entry had before its rewrite: the newest committed version of the file without the rewrite heading.
 * Read from the path's history, so an entry added under another name (a rename) or edited after it was added works.
 */
export function originalFromGit(file, cwd = ROOT) {
  const shas = execFileSync('git', ['log', '--format=%H', '--', file], { cwd, encoding: 'utf8' }).split('\n').filter(Boolean)
  for (const sha of shas) {
    const text = execFileSync('git', ['show', `${sha}:${file}`], { cwd, encoding: 'utf8' })
    if (!text.includes(`\n${MARK}\n`)) return text
  }
  throw new Error(`no committed version of ${file} lacks the rewrite heading`)
}

const readFromRepo = (file) => {
  try {
    return readFileSync(join(ROOT, file), 'utf8')
  } catch {
    return null // slop-ok: a missing file is a finding in the batch, not a crash
  }
}

function usage(message) {
  console.error(`changelog-rewrite: ${message}`)
  console.error('usage: changelog-rewrite.mjs [--dry-run | --write | --check] <batch.json>')
  return 2
}

/** The check mode: each entry is what --write makes. Returns the exit code. */
function runCheck(batch, batchPath) {
  const result = checkBatch(batch, readFromRepo, (file) => originalFromGit(file))
  for (const finding of result.findings) console.log(finding)
  console.log(result.ok ? `changelog-rewrite: ${batchPath} matches its entries` : `changelog-rewrite: ${result.findings.length} finding(s)`)
  return result.ok ? 0 : 1
}

/** The dry-run and write modes. Any finding stops the batch before a file is written. Returns the exit code. */
function runPlan(batch, mode) {
  const plan = planBatch(batch, readFromRepo)
  if (!plan.ok) {
    for (const finding of plan.findings) console.log(finding)
    console.log(`changelog-rewrite: ${plan.findings.length} finding(s), nothing written`)
    return 1
  }
  for (const change of plan.changes) {
    console.log(change.file)
    console.log(`  old title: ${change.oldTitle || '(none)'}`)
    console.log(`  new title: ${change.newTitle}`)
    for (const line of change.lines) console.log(`  line: ${line}`)
  }
  const count = plan.changes.length
  const noun = count === 1 ? 'entry' : 'entries'
  if (mode === '--write') {
    for (const change of plan.changes) writeFileSync(join(ROOT, change.file), change.to)
    console.log(`changelog-rewrite: wrote ${count} ${noun}, ${batch.length - count} already done`)
  } else {
    console.log(`changelog-rewrite: dry run, ${count} ${noun} would change, nothing written`)
  }
  return 0
}

/** The command line. Returns the exit code. */
export function main(argv = process.argv.slice(2)) {
  const modes = argv.filter((a) => ['--dry-run', '--write', '--check'].includes(a))
  const paths = argv.filter((a) => !a.startsWith('--'))
  if (modes.length > 1 || paths.length !== 1 || argv.length !== modes.length + paths.length) return usage('give one batch file and at most one mode')
  let batch
  try {
    batch = JSON.parse(readFileSync(paths[0], 'utf8'))
  } catch (error) {
    return usage(`cannot read ${paths[0]}: ${error.message}`)
  }
  return modes[0] === '--check' ? runCheck(batch, paths[0]) : runPlan(batch, modes[0] ?? '--dry-run')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main())
}
