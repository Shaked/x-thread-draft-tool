#!/usr/bin/env node
// Changelog check (plan #369, steps 1 and 2). A pull request may add entries under docs/changelogs/. It may change an
// existing entry only in a batch under docs/changelog-rewrites/ that passes `changelog-rewrite.mjs --check` in the same
// pull request, and it may not delete one. Each added entry must pass the changelog lint (scripts/reply-lint.mjs
// --kind=changelog). No network.
//
// A visible change (src/, server/mcp/ui/) needs a screenshot line in each added entry (#603).
// Usage: BASE_SHA=<base commit> node scripts/changelog-check.mjs   (run from the repository root)
// Exits 1 when a finding is printed. Each finding prints `<path>: <message>`.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { lint } from './reply-lint.mjs'
import { BATCH_DIR, checkBatch, originalFromGit } from './changelog-rewrite.mjs'

const DIR = 'docs/changelogs/'

/** Pure: the batch files a pull request adds or changes, from `git diff --name-status` lines. */
export function changedBatches(nameStatus) {
  return nameStatus
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'))
    .filter(([status, ...paths]) => !status.startsWith('D') && paths.at(-1)?.startsWith(BATCH_DIR) && paths.at(-1).endsWith('.json'))
    .map((parts) => parts.at(-1))
}

/**
 * Pure: findings for the `git diff --name-status` lines of a pull request. `readText(path)` gives the text of a file.
 * `covered` is the set of existing entries that a passing batch rewrites. README.md and files outside DIR are skipped.
 */
export function checkChanges(nameStatus, readText, { covered = new Set() } = {}) {
  const findings = []
  for (const line of nameStatus.split('\n').filter(Boolean)) {
    const [status, ...paths] = line.split('\t')
    const path = paths.at(-1) || ''
    if (!path.startsWith(DIR) || !path.endsWith('.md') || path === `${DIR}README.md`) continue
    if (!status.startsWith('A')) {
      const rewritten = status.startsWith('M') && covered.has(path)
      if (!rewritten) findings.push(`${path}: an existing entry may not change or be deleted (git status ${status})`)
      continue
    }
    for (const f of lint(readText(path), { kind: 'changelog' })) {
      findings.push(`${path} line ${f.line}: ${f.rule}: ${f.message}`)
    }
  }
  return findings
}

const SHOT_DIRS = ['src/', 'server/mcp/ui/']
const SHOT_DIR = 'docs/changelogs/img/'
const SHOT_MAX = 200 * 1024 // at most 200 KB

/**
 * Pure: screenshot findings (#603). A pull request that changes src/ or server/mcp/ui/ must give each added entry a
 * `Screenshot:` line that is `img/<same name>.png` (plain, or as a markdown image) and a PNG of at most 200 KB, or
 * `Screenshot: not needed, <reason>`. `sizeOf(path)` gives the bytes of a file, or null when it is missing.
 */
export function checkScreenshots(nameStatus, readText, sizeOf) {
  const rows = nameStatus.split('\n').filter(Boolean).map((line) => line.split('\t'))
  if (!rows.some((parts) => SHOT_DIRS.some((dir) => parts.at(-1).startsWith(dir)))) return []
  return rows.flatMap(([status, ...paths]) => {
    const path = paths.at(-1)
    if (!status.startsWith('A') || !path.startsWith(DIR) || !path.endsWith('.md') || path === `${DIR}README.md`) return []
    const name = path.slice(DIR.length, -3)
    const shot = (/^Screenshot: (.*)$/m.exec(readText(path) || '')?.[1] || '').trim()
    if (/^not needed, \S/.test(shot)) return []
    if (/^not needed\b/.test(shot)) return [`${path}: "Screenshot: not needed" needs a reason after the comma`]
    if (!shot) return [`${path}: a visible change needs a "Screenshot:" line: img/${name}.png, or "Screenshot: not needed, <reason>"`]
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const link = new RegExp(`^(!\\[[^\\]]*\\]\\(img/${esc}\\.png\\)|img/${esc}\\.png)$`)
    if (!link.test(shot)) return [`${path}: the Screenshot line must link img/${name}.png`]
    const png = `${SHOT_DIR}${name}.png`
    const size = sizeOf(png)
    if (size === null) return [`${png}: the screenshot is missing`]
    return size > SHOT_MAX ? [`${png}: the screenshot is ${size} bytes, over 200 KB`] : []
  })
}

/** The findings of each batch a pull request changes, and the entries those batches rewrite. */
export function checkBatches(batchFiles, readBatch, readText, readOriginal) {
  const findings = []
  const covered = new Set()
  for (const path of batchFiles) {
    let batch
    try {
      batch = JSON.parse(readBatch(path))
    } catch (error) {
      findings.push(`${path}: not valid JSON (${error.message})`)
      continue
    }
    const result = checkBatch(batch, readText, readOriginal)
    if (!result.ok) {
      for (const finding of result.findings) findings.push(`${path}: ${finding}`)
      continue
    }
    for (const entry of batch) covered.add(entry.file)
  }
  return { findings, covered }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.env.BASE_SHA || ''
  if (!/^[0-9a-f]{7,40}$/.test(base)) {
    console.log('changelog-check: BASE_SHA must be a commit id')
    process.exit(1)
  }
  const nameStatus = execFileSync('git', ['diff', '--no-renames', '--name-status', `${base}...HEAD`], { encoding: 'utf8' })
  const readText = (path) => {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return null // slop-ok: a missing entry is a finding in its batch, not a crash
    }
  }
  const sizeOf = (path) => (existsSync(path) ? statSync(path).size : null)
  const batches = checkBatches(changedBatches(nameStatus), (path) => readFileSync(path, 'utf8'), readText, (file) => originalFromGit(file, base))
  const findings = [
    ...batches.findings,
    ...checkChanges(nameStatus, readText, { covered: batches.covered }),
    ...checkScreenshots(nameStatus, readText, sizeOf)
  ]
  for (const finding of findings) console.log(finding)
  console.log(findings.length ? `changelog-check: ${findings.length} finding(s)` : 'changelog-check: OK')
  if (findings.length) process.exit(1)
}
