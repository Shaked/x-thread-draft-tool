#!/usr/bin/env node
// Changelog check (plan #369, steps 1 and 2). A pull request may add entries under docs/changelogs/. It may change an
// existing entry only in a batch under docs/changelog-rewrites/ that passes `changelog-rewrite.mjs --check` in the same
// pull request, and it may not delete one. Each added entry must pass the changelog lint (scripts/reply-lint.mjs
// --kind=changelog). No network.
//
// Usage: BASE_SHA=<base commit> node scripts/changelog-check.mjs   (run from the repository root)
// Exits 1 when a finding is printed. Each finding prints `<path>: <message>`.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
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
  const nameStatus = execFileSync('git', ['diff', '--name-status', `${base}...HEAD`, '--', DIR, BATCH_DIR], { encoding: 'utf8' })
  const readText = (path) => {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return null // slop-ok: a missing entry is a finding in its batch, not a crash
    }
  }
  const batches = checkBatches(changedBatches(nameStatus), (path) => readFileSync(path, 'utf8'), readText, (file) => originalFromGit(file))
  const findings = [...batches.findings, ...checkChanges(nameStatus, readText, { covered: batches.covered })]
  for (const finding of findings) console.log(finding)
  console.log(findings.length ? `changelog-check: ${findings.length} finding(s)` : 'changelog-check: OK')
  if (findings.length) process.exit(1)
}
