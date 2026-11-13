#!/usr/bin/env node
// Test time budget: runs the whole vitest suite, then fails when one test file takes longer
// than FILE_LIMIT_MS or the run takes longer than TOTAL_LIMIT_MS. A file's time includes its
// beforeAll/afterAll hooks, and the run uses a fixed number of workers so CI and local runs compare. Prints the five slowest files.
// The limits can be lowered for a check, for example: TEST_BUDGET_FILE_MS=100 npm run test:budget

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Falls back to the working directory when the module runs under a non-file URL (jsdom in unit tests).
const ROOT = (() => {
  try {
    return fileURLToPath(new URL('..', import.meta.url))
  } catch {
    return process.cwd()
  }
})()
export const FILE_LIMIT_MS = Number(process.env.TEST_BUDGET_FILE_MS ?? 5000)
export const TOTAL_LIMIT_MS = Number(process.env.TEST_BUDGET_TOTAL_MS ?? 50000)
// Per-file exceptions. Keep this list short and say why next to each entry.
export const FILE_LIMIT_OVERRIDES = {
  'tests/api/migrate.test.js': 7000, // boots a fresh PGlite and replays every migration; O11 decided by Opus 2026-11-13, revises D-8
  'tests/api/oauth-migration.test.js': 7000 // boots a fresh PGlite and replays every migration; O11 decided by Opus 2026-11-13, revises D-8
}
const WORKERS = Number(process.env.TEST_BUDGET_WORKERS ?? 3)
const SLOWEST_SHOWN = 5

/** Per-file durations in whole milliseconds, slowest first, from the rows of test-budget-reporter.mjs. */
export function fileDurations(rows, root = ROOT) {
  return rows
    .map(({ file, ms }) => ({ file: relative(root, file), ms: Math.round(ms) }))
    .sort((a, b) => b.ms - a.ms)
}

/** Lists every budget violation; empty when the run is within budget. */
export function violations(durations, totalMs) {
  const problems = []
  for (const { file, ms } of durations) {
    const limit = FILE_LIMIT_OVERRIDES[file] ?? FILE_LIMIT_MS
    if (ms > limit) problems.push(`${file} took ${ms} ms (limit ${limit} ms)`)
  }
  if (totalMs > TOTAL_LIMIT_MS) problems.push(`total ${Math.round(totalMs)} ms (limit ${TOTAL_LIMIT_MS} ms)`)
  return problems
}

function main() {
  const dir = mkdtempSync(join(tmpdir(), 'xt-test-budget-'))
  const reportPath = join(dir, 'vitest.json')
  const started = performance.now()
  const run = spawnSync(
    process.execPath,
    [
      join(ROOT, 'node_modules/vitest/vitest.mjs'),
      'run',
      '--reporter=default',
      `--reporter=${join(ROOT, 'scripts/test-budget-reporter.mjs')}`,
      `--maxWorkers=${WORKERS}`
    ],
    { cwd: ROOT, stdio: 'inherit', env: { ...process.env, TEST_BUDGET_OUT: reportPath } }
  )
  const totalMs = performance.now() - started

  let rows
  try {
    rows = JSON.parse(readFileSync(reportPath, 'utf8'))
  } catch {
    process.exit(run.status || 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  const durations = fileDurations(rows)
  console.log(`\ntest-budget: total ${Math.round(totalMs)} ms over ${durations.length} files`)
  console.log(`test-budget: workers ${WORKERS} (cpus ${availableParallelism()})`)
  console.log(`test-budget: ${SLOWEST_SHOWN} slowest files:`)
  for (const { file, ms } of durations.slice(0, SLOWEST_SHOWN)) {
    console.log(`  ${String(ms).padStart(6)} ms  ${file}`)
  }

  const problems = violations(durations, totalMs)
  for (const problem of problems) console.error(`test-budget: over budget: ${problem}`)
  if (run.status !== 0) process.exit(run.status ?? 1)
  if (problems.length > 0) process.exit(1)
  console.log('test-budget: within budget')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
