#!/usr/bin/env node
// Net-lines rule: product code must not grow overall. Counts added and removed lines in
// src/, server/, api/ and scripts/ between origin/main and HEAD. Tests, docs and lockfiles
// are not counted. Passes when added <= removed, or when the pull request body points to a
// plan task, for example "Implements docs/plans/post-migration-hardening.md Task 3.5".
//
// Usage (CI): PR_BODY is passed through the environment only, never inlined in a script.

import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const COUNTED_DIRS = ['src/', 'server/', 'api/', 'scripts/']
const LOCKFILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/
const PLAN_REFERENCE = /docs\/plans\/[a-z0-9-]+\.md.*Task \d+(\.\d+)?/

/** True when a numstat path counts toward the rule. */
export function isCounted(path) {
  if (!COUNTED_DIRS.some((dir) => path.startsWith(dir))) return false
  if (/\.test\./.test(path)) return false
  if (LOCKFILE.test(path)) return false
  return true
}

/** Sums added and removed lines from `git diff --numstat` output. Binary files count as zero. */
export function countNetLines(numstat) {
  let added = 0
  let removed = 0
  for (const line of numstat.split('\n')) {
    if (!line.trim()) continue
    const [addedText, removedText, ...pathParts] = line.split('\t')
    const path = pathParts.join('\t')
    if (!isCounted(path)) continue
    added += Number(addedText) || 0
    removed += Number(removedText) || 0
  }
  return { added, removed }
}

/** Decides pass or fail from the numstat text and the pull request body. */
export function evaluate({ numstat, body = '' }) {
  const { added, removed } = countNetLines(numstat)
  if (added <= removed) {
    return { pass: true, added, removed, reason: 'added lines do not exceed removed lines' }
  }
  if (PLAN_REFERENCE.test(body)) {
    return { pass: true, added, removed, reason: 'pull request is a planned task (plan reference in the body)' }
  }
  return {
    pass: false,
    added,
    removed,
    reason: 'added lines exceed removed lines and the pull request body does not reference a plan task'
  }
}

function main() {
  const numstat = execFileSync('git', ['diff', '--numstat', '--no-renames', 'origin/main...HEAD'], { encoding: 'utf8' })
  const result = evaluate({ numstat, body: process.env.PR_BODY || '' })
  console.log(`net-lines: added ${result.added}, removed ${result.removed}`)
  console.log(`net-lines: ${result.pass ? 'PASS' : 'FAIL'}: ${result.reason}`)
  if (!result.pass) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
