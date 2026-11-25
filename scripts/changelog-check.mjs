#!/usr/bin/env node
// Changelog check (plan #369, step 1). A pull request may add entries under docs/changelogs/ and may not change
// or delete an existing one: old entries change only through a reviewed script (docs/operations/changelog.md).
// Each added entry must pass the changelog lint (scripts/reply-lint.mjs --kind=changelog). No network.
//
// Usage: BASE_SHA=<base commit> node scripts/changelog-check.mjs   (run from the repository root)
// Exits 1 when a finding is printed. Each finding prints `<path>: <message>`.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { lint } from './reply-lint.mjs'

const DIR = 'docs/changelogs/'

/**
 * Pure: findings for the `git diff --name-status` lines of a pull request. `readText(path)` gives the text of an
 * added file. README.md and files outside DIR are skipped.
 */
export function checkChanges(nameStatus, readText) {
  const findings = []
  for (const line of nameStatus.split('\n').filter(Boolean)) {
    const [status, ...paths] = line.split('\t')
    const path = paths.at(-1) || ''
    if (!path.startsWith(DIR) || !path.endsWith('.md') || path === `${DIR}README.md`) continue
    if (!status.startsWith('A')) {
      findings.push(`${path}: an existing entry may not change or be deleted (git status ${status})`)
      continue
    }
    for (const f of lint(readText(path), { kind: 'changelog' })) {
      findings.push(`${path} line ${f.line}: ${f.rule}: ${f.message}`)
    }
  }
  return findings
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.env.BASE_SHA || ''
  if (!/^[0-9a-f]{7,40}$/.test(base)) {
    console.log('changelog-check: BASE_SHA must be a commit id')
    process.exit(1)
  }
  const nameStatus = execFileSync('git', ['diff', '--name-status', `${base}...HEAD`, '--', DIR], { encoding: 'utf8' })
  const findings = checkChanges(nameStatus, (path) => readFileSync(path, 'utf8'))
  for (const finding of findings) console.log(finding)
  console.log(findings.length ? `changelog-check: ${findings.length} finding(s)` : 'changelog-check: OK')
  if (findings.length) process.exit(1)
}
