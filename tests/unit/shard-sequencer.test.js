// Guard for #605 and #634: --shard=n/m splits the test files by time, the shards cover every file once, they stay
// balanced, and a small edit to the tables moves only a few files.
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildAssignment, placeItems, rebalance } from '../shard-balance.mjs'
import { ASSIGNMENT, FALLBACK_MS, TIMINGS, TimedShardSequencer, slowestFirst, splitByTime } from '../shard-sequencer.mjs'

// The working directory is the repo root (jsdom has no file URL for this module).
const ROOT = process.cwd()
const keys = Object.keys(TIMINGS)
const sumOf = (items) => items.reduce((total, item) => total + item.ms, 0)

const COUNT = ASSIGNMENT.shards
const entries = keys.map((key) => ({ key }))
const shardOf = (shards) => Object.fromEntries(shards.flatMap((items, index) => items.map((item) => [item.key, index + 1])))
const movedBetween = (before, after) => Object.keys(before).filter((key) => key in after && before[key] !== after[key]).length

describe('splitByTime', () => {
  it('puts every timed file in exactly one shard of the assignment', () => {
    const shards = splitByTime(entries, COUNT)
    const placed = shards.flat().map((item) => item.key)
    expect(shards).toHaveLength(COUNT)
    expect([...placed].sort()).toEqual([...keys].sort())
  })

  it('has an assignment for every file in the table, and none for a file that is not in it', () => {
    expect(Object.keys(ASSIGNMENT.files).sort()).toEqual([...keys].sort())
  })

  it('keeps the committed shard totals within 3 percent of each other', () => {
    const totals = splitByTime(entries, COUNT).map(sumOf)
    const mean = totals.reduce((a, b) => a + b, 0) / totals.length
    expect(Math.max(...totals) - Math.min(...totals), `totals ${totals.join(' / ')}; run npm run shard-timings:ci`).toBeLessThanOrEqual(mean * 0.03)
  })

  it('gives the same split on every call and for any input order, so every CI shard agrees', () => {
    expect(splitByTime(entries, COUNT)).toEqual(splitByTime(entries, COUNT))
    const timings = { 'a.js': 100, 'b.js': 100, 'c.js': 100, 'd.js': 100 }
    const forward = ['a.js', 'b.js', 'c.js', 'd.js'].map((key) => ({ key }))
    const split = (list) => shardOf(splitByTime(list, 2, timings, 10, { shards: 0, files: {} }))
    expect(split([...forward].reverse())).toEqual(split(forward))
    expect(split(forward)).toEqual({ 'a.js': 1, 'b.js': 2, 'c.js': 1, 'd.js': 2 })
  })

  it('counts a file missing from the table as the fallback time', () => {
    const timings = { 'tests/a.test.js': 1000 }
    const none = { shards: 0, files: {} }
    const shards = splitByTime([{ key: 'tests/a.test.js' }, { key: 'tests/new.test.js' }], 2, timings, 10, none)
    expect(shards.map((items) => items.map((item) => item.key))).toEqual([['tests/a.test.js'], ['tests/new.test.js']])
    expect(FALLBACK_MS).toBeGreaterThan(0)
  })

  it('ignores an assignment made for another number of shards', () => {
    const timings = { 'a.js': 100, 'b.js': 100 }
    const other = { shards: 3, files: { 'a.js': 3, 'b.js': 3 } }
    expect(shardOf(splitByTime([{ key: 'a.js' }, { key: 'b.js' }], 2, timings, 10, other))).toEqual({ 'a.js': 1, 'b.js': 2 })
  })
})

describe('stable assignment', () => {
  const before = shardOf(splitByTime(entries, COUNT))

  it('moves no file when one time in the table changes', () => {
    for (const key of [keys[0], keys[40], keys[120]]) {
      const timings = { ...TIMINGS, [key]: TIMINGS[key] * 3 + 500 }
      expect(movedBetween(before, shardOf(splitByTime(entries, COUNT, timings)))).toBe(0)
    }
  })

  it('moves no existing file when a file is added or removed, and the new file goes to the lightest shard', () => {
    const withNew = [...entries, { key: 'tests/api/zz-new.test.js' }]
    const added = shardOf(splitByTime(withNew, COUNT))
    expect(movedBetween(before, added)).toBe(0)
    const totals = splitByTime(entries, COUNT).map(sumOf)
    expect(added['tests/api/zz-new.test.js']).toBe(totals.indexOf(Math.min(...totals)) + 1)
    expect(movedBetween(before, shardOf(splitByTime(entries.slice(1), COUNT)))).toBe(0)
  })

  it('moves a handful of files (8 at most, not dozens) when one time grows by 50 percent and the table is rebalanced with the balance script', () => {
    for (const key of [keys[0], keys[40], keys[120]]) {
      const timings = { ...TIMINGS, [key]: Math.round(TIMINGS[key] * 1.5) + 300 }
      const next = buildAssignment(timings, COUNT, ASSIGNMENT.files)
      expect(movedBetween(ASSIGNMENT.files, next.files)).toBeLessThanOrEqual(8)
    }
  })

  it('does not move a file when the committed assignment is rebuilt from the committed table', () => {
    expect(buildAssignment(TIMINGS, COUNT, ASSIGNMENT.files)).toEqual(ASSIGNMENT)
  })
})

describe('placeItems and rebalance', () => {
  const items = [900, 800, 700, 600, 500, 400, 300, 200].map((ms, index) => ({ key: `f${index}`, ms }))
  const loads = (bins) => bins.map(sumOf)

  it('puts pinned items where they are pinned and the rest slowest first on the lightest bin', () => {
    const bins = placeItems(items, 2, { f0: 2, f1: 2 })
    expect(bins[1].map((item) => item.key)).toEqual(expect.arrayContaining(['f0', 'f1']))
    expect(loads(bins).reduce((a, b) => a + b, 0)).toBe(4400)
  })

  it('never makes the heaviest bin heavier, and stops when nothing helps', () => {
    const lopsided = [items.slice(0, 5), items.slice(5)]
    const { bins, moved } = rebalance(lopsided)
    expect(Math.max(...loads(bins))).toBeLessThan(Math.max(...loads(lopsided)))
    expect(bins.flat()).toHaveLength(items.length)
    expect(moved).toBeGreaterThan(0)
    expect(rebalance(bins).moved).toBe(0)
  })

  it('moves at most maxMoves items', () => {
    expect(rebalance([items, []], 1).moved).toBe(1)
  })
})

describe('TimedShardSequencer', () => {
  it('gives each shard its own share, and the shares cover every file once', async () => {
    const files = keys.map((key) => ({ moduleId: join(ROOT, key) }))
    const picked = []
    for (let index = 1; index <= COUNT; index++) {
      const sequencer = new TimedShardSequencer({ config: { root: ROOT, shard: { index, count: COUNT } } })
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
