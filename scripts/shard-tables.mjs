// Writes tests/shard-timings.json (worker ms per test file) and tests/shard-assignment.json (which shard runs it).
// Shared by `npm run shard-timings` (local runs) and `npm run shard-timings:ci` (CI logs), #634.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildAssignment } from '../tests/shard-balance.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const TIMINGS_PATH = join(ROOT, 'tests/shard-timings.json')
const ASSIGNMENT_PATH = join(ROOT, 'tests/shard-assignment.json')

export const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

export const currentTimings = () => readJson(TIMINGS_PATH) ?? {}
export const currentShardCount = () => readJson(ASSIGNMENT_PATH)?.shards ?? 3

/** Saves the times and a balanced assignment for `shards` shards. Files whose shard still fits stay where they are. */
export function saveTables(timings, shards) {
  const sorted = Object.fromEntries(Object.keys(timings).sort().map((key) => [key, Math.round(timings[key])]))
  const previous = readJson(ASSIGNMENT_PATH)
  const kept = previous?.shards === shards ? previous.files : {}
  const assignment = buildAssignment(sorted, shards, kept)
  writeFileSync(TIMINGS_PATH, `${JSON.stringify(sorted, null, 2)}\n`)
  writeFileSync(ASSIGNMENT_PATH, `${JSON.stringify(assignment, null, 2)}\n`)
  const moved = Object.keys(assignment.files).filter((key) => key in kept && kept[key] !== assignment.files[key]).length
  const totals = Array.from({ length: shards }, (_, index) =>
    Object.keys(sorted).reduce((sum, key) => sum + (assignment.files[key] === index + 1 ? sorted[key] : 0), 0)
  )
  return { files: Object.keys(sorted).length, moved, totals }
}
