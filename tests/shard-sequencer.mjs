// Splits the test files of --shard=n/m by measured time (#605). Vitest's default sequencer hashes each
// file path and cuts the list into equal counts, so one shard can hold much more time than another
// (local runs: one shard 21 to 23 s heavier than another). The time of a file is its worker time: environment,
// setup, import and tests (tests/shard-timings.json, median of CI runs, #634). The split is pinned in
// tests/shard-assignment.json, so editing a time moves no file; a file missing from the assignment goes slowest first
// to the shard with the least time so far, and a file missing from the times counts as the median.
// Every shard computes the same split, so the CI jobs never overlap and never miss a file.
import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { BaseSequencer } from 'vitest/node'
import { placeItems } from './shard-balance.mjs'

// The unit project runs under jsdom, where this module has no file URL, so fall back to the repo root.
const readTable = (name) => {
  try {
    return JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'))
  } catch {
    return JSON.parse(readFileSync(join(process.cwd(), 'tests', name), 'utf8'))
  }
}
export const TIMINGS = readTable('shard-timings.json')
export const ASSIGNMENT = readTable('shard-assignment.json')

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}
export const FALLBACK_MS = median(Object.values(TIMINGS))

/** The pinned shard of each file for a run of `count` shards; empty when the table was made for another count. */
const pinnedFor = (count, assignment) => (assignment.shards === count ? assignment.files : {})

/** Splits {key, ...} entries into `count` lists with about equal total ms. Files named in the assignment stay in
 * their shard; the others go slowest first (ties by name) to the shard with the least time so far. */
export function splitByTime(entries, count, timings = TIMINGS, fallbackMs = FALLBACK_MS, assignment = ASSIGNMENT) {
  const timed = entries.map((entry) => ({ ...entry, ms: timings[entry.key] ?? fallbackMs }))
  return placeItems(timed, count, pinnedFor(count, assignment))
}

/** Orders specs inside a shard: group order and project name as vitest does, then the slowest file first, so the
 * longest files start at once and a short file fills the gap at the end (#605). */
export function slowestFirst(specs, root, timings = TIMINGS, fallbackMs = FALLBACK_MS) {
  const keyOf = (spec) => relative(root, spec.moduleId).split(sep).join('/')
  return [...specs].sort((a, b) => {
    const group = a.project.config.sequence.groupOrder - b.project.config.sequence.groupOrder
    if (group !== 0) return group
    if (a.project.name !== b.project.name) return a.project.name < b.project.name ? -1 : 1
    const [keyA, keyB] = [keyOf(a), keyOf(b)]
    return (timings[keyB] ?? fallbackMs) - (timings[keyA] ?? fallbackMs) || (keyA < keyB ? -1 : keyA > keyB ? 1 : 0)
  })
}

export class TimedShardSequencer extends BaseSequencer {
  async sort(files) {
    return slowestFirst(files, this.ctx.config.root)
  }

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
