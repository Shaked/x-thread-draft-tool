#!/usr/bin/env node
// Rebuilds tests/shard-timings.json, the per-file worker times that tests/shard-sequencer.mjs uses to split
// --shard=n/m (#605). Runs the whole suite N times (default 3) on this machine and keeps each file's median.
// Usage: npm run shard-timings [-- --runs=3]. Refresh it when the warning from shard-sequencer names new files,
// or after a large change to the test files (docs/operations/shard-timings.md). A local machine is not CI: prefer
// npm run shard-timings:ci (scripts/ci-shard-timings.mjs), which reads the times CI measured (#634).
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { currentShardCount, saveTables } from '../scripts/shard-tables.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const runsArg = process.argv.find((arg) => arg.startsWith('--runs='))
const RUNS = runsArg ? Number(runsArg.slice('--runs='.length)) : 3
if (!Number.isInteger(RUNS) || RUNS < 1) throw new Error(`shard-timings: bad ${runsArg} (use --runs=1 or more)`)

const dir = mkdtempSync(join(tmpdir(), 'xt-shard-timings-'))
const byKey = new Map()
try {
  for (let run = 1; run <= RUNS; run++) {
    const out = join(dir, `run-${run}.json`)
    const result = spawnSync(
      process.execPath,
      [join(ROOT, 'node_modules/vitest/vitest.mjs'), 'run', '--reporter=default', `--reporter=${join(ROOT, 'tests/shard-phase-reporter.mjs')}`, '--maxWorkers=3'],
      { cwd: ROOT, stdio: 'inherit', env: { ...process.env, SHARD_TIMINGS_OUT: out } }
    )
    if (result.status !== 0) throw new Error(`shard-timings: the suite failed on run ${run}; the table is not changed`)
    for (const { file, ms } of JSON.parse(readFileSync(out, 'utf8'))) {
      const key = relative(ROOT, file).split(sep).join('/')
      if (!byKey.has(key)) byKey.set(key, [])
      byKey.get(key).push(ms)
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}
const table = {}
for (const key of [...byKey.keys()].sort()) table[key] = Math.round(median(byKey.get(key)))
const saved = saveTables(table, currentShardCount())
console.log(`shard-timings: ${saved.files} files, median of ${RUNS} run(s), ${saved.moved} moved between shards; shard totals ${saved.totals.join(' / ')} ms`)
