// Splits the test files of --shard=n/m by measured time (#605). Vitest's default sequencer hashes each
// file path and cuts the list into equal counts, so one shard can hold much more time than another
// (local runs: one shard 21 to 23 s heavier than another). This gives the files out slowest first, each to
// the shard with the least time so far. The time of a file is its worker time: environment, setup, import and
// tests (tests/shard-timings.json, median of three full local runs). A file missing from it counts as the median.
// Every shard computes the same split, so the CI jobs never overlap and never miss a file.
import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { BaseSequencer } from 'vitest/node'

// The unit project runs under jsdom, where this module has no file URL, so fall back to the repo root.
const readTimings = () => {
  try {
    return readFileSync(new URL('./shard-timings.json', import.meta.url), 'utf8')
  } catch {
    return readFileSync(join(process.cwd(), 'tests/shard-timings.json'), 'utf8')
  }
}
export const TIMINGS = JSON.parse(readTimings())

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}
export const FALLBACK_MS = median(Object.values(TIMINGS))

/** Splits {key, ...} entries into `count` lists with about equal total ms, slowest entries first. */
export function splitByTime(entries, count, timings = TIMINGS, fallbackMs = FALLBACK_MS) {
  const timed = entries.map((entry) => ({ ...entry, ms: timings[entry.key] ?? fallbackMs }))
  timed.sort((a, b) => b.ms - a.ms || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const bins = Array.from({ length: count }, () => ({ ms: 0, items: [] }))
  for (const item of timed) {
    const bin = bins.reduce((least, candidate) => (candidate.ms < least.ms ? candidate : least))
    bin.ms += item.ms
    bin.items.push(item)
  }
  return bins.map((bin) => bin.items)
}

export class TimedShardSequencer extends BaseSequencer {
  async shard(files) {
    const { index, count } = this.ctx.config.shard
    const root = this.ctx.config.root
    const entries = files.map((spec) => ({ spec, key: relative(root, spec.moduleId).split(sep).join('/') }))
    const missing = entries.filter((entry) => !(entry.key in TIMINGS)).map((entry) => entry.key)
    if (missing.length > 0) {
      console.warn(
        `shard-sequencer: ${missing.length} test file(s) have no time in tests/shard-timings.json and count as ${FALLBACK_MS} ms: ` +
          `${missing.join(', ')}. Refresh the table with npm run shard-timings (docs/operations/shard-timings.md).`
      )
    }
    return splitByTime(entries, count)[index - 1].map((entry) => entry.spec)
  }
}
