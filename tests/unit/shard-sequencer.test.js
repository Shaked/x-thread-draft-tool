// Guard for #605: --shard=n/m splits the test files by time, and the three shards cover every file once.
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FALLBACK_MS, TIMINGS, TimedShardSequencer, slowestFirst, splitByTime } from '../shard-sequencer.mjs'

// The working directory is the repo root (jsdom has no file URL for this module).
const ROOT = process.cwd()
const keys = Object.keys(TIMINGS)
const sumOf = (items) => items.reduce((total, item) => total + item.ms, 0)

describe('splitByTime', () => {
  it('puts every timed file in exactly one of the three shards', () => {
    const shards = splitByTime(keys.map((key) => ({ key })), 3)
    const placed = shards.flat().map((item) => item.key)
    expect(shards).toHaveLength(3)
    expect([...placed].sort()).toEqual([...keys].sort())
  })

  it('keeps the shard totals within one file of each other', () => {
    const shards = splitByTime(keys.map((key) => ({ key })), 3)
    const totals = shards.map(sumOf)
    const largest = Math.max(...keys.map((key) => TIMINGS[key]))
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(largest)
  })

  it('gives the same split on every call, so every CI shard agrees', () => {
    const entries = keys.map((key) => ({ key }))
    expect(splitByTime(entries, 3)).toEqual(splitByTime(entries, 3))
  })

  it('counts a file missing from the table as the fallback time', () => {
    const timings = { 'tests/a.test.js': 1000 }
    const shards = splitByTime([{ key: 'tests/a.test.js' }, { key: 'tests/new.test.js' }], 2, timings, 10)
    expect(shards.map((items) => items.map((item) => item.key))).toEqual([['tests/a.test.js'], ['tests/new.test.js']])
    expect(FALLBACK_MS).toBeGreaterThan(0)
  })
})

describe('TimedShardSequencer', () => {
  it('gives each shard its own share, and the three shares cover every file once', async () => {
    const files = keys.map((key) => ({ moduleId: join(ROOT, key) }))
    const picked = []
    for (let index = 1; index <= 3; index++) {
      const sequencer = new TimedShardSequencer({ config: { root: ROOT, shard: { index, count: 3 } } })
      picked.push((await sequencer.shard(files)).map((spec) => spec.moduleId))
    }
    expect(picked.flat().sort()).toEqual(files.map((spec) => spec.moduleId).sort())
  })
})

describe('slowestFirst', () => {
  const spec = (name, project = 'api', groupOrder = 0) => ({
    moduleId: join(ROOT, name),
    project: { name: project, config: { sequence: { groupOrder } } }
  })
  const order = (specs, timings) => slowestFirst(specs, ROOT, timings, 100).map((s) => s.moduleId.slice(ROOT.length + 1))

  it('puts the slowest file first inside a project, and a file missing from the table counts as the fallback', () => {
    const timings = { 'tests/api/a.test.js': 500, 'tests/api/b.test.js': 3000 }
    const specs = [spec('tests/api/a.test.js'), spec('tests/api/new.test.js'), spec('tests/api/b.test.js')]
    expect(order(specs, timings)).toEqual(['tests/api/b.test.js', 'tests/api/a.test.js', 'tests/api/new.test.js'])
  })

  it('keeps the project order of vitest: api before unit, whatever the times', () => {
    const timings = { 'tests/unit/slow.test.js': 9000, 'tests/api/fast.test.js': 10 }
    const specs = [spec('tests/unit/slow.test.js', 'unit'), spec('tests/api/fast.test.js')]
    expect(order(specs, timings)).toEqual(['tests/api/fast.test.js', 'tests/unit/slow.test.js'])
  })
})
