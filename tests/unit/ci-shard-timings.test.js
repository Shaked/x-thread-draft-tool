// @vitest-environment node
// Guard for #634: the shard table is rebuilt from the `test-budget-file:` lines the CI unit shards print.
import { describe, expect, it } from 'vitest'
import { median, medianTimings, parseJobLog } from '../../scripts/ci-shard-timings.mjs'

const log = (rows, total) =>
  [
    '2026-11-28T03:14:09.1Z test-budget: total ' + total + ' ms over ' + rows.length + ' files',
    ...rows.map(([file, ms]) => `2026-11-28T03:14:09.2Z \u001b[2mtest-budget-file: ${ms} ${file}\u001b[22m`),
    '2026-11-28T03:14:09.3Z test-budget: within budget'
  ].join('\n')

describe('parseJobLog', () => {
  it('reads the per-file worker times and the wall time, through colour codes and timestamps', () => {
    expect(parseJobLog(log([['tests/api/a.test.js', 1200], ['tests/unit/b.test.js', 80]], 39605))).toEqual({
      files: { 'tests/api/a.test.js': 1200, 'tests/unit/b.test.js': 80 },
      totalMs: 39605
    })
  })

  it('returns null for a log without file lines (an old run or a cancelled job)', () => {
    expect(parseJobLog('test-budget: total 1000 ms over 3 files')).toBeNull()
  })
})

describe('medianTimings', () => {
  const job = (ms) => ({ files: { 'a.js': ms, 'b.js': 100 }, totalMs: 1 })

  it('takes the median per file, so one slow runner does not move the table', () => {
    expect(medianTimings([job(1000), job(1100), job(5000)])).toEqual({ 'a.js': 1100, 'b.js': 100 })
    expect(median([3, 1, 2])).toBe(2)
  })

  it('keeps the old time of a file seen too few times, and the files no log mentions', () => {
    const jobs = [job(1000), job(1100), { files: { 'c.js': 7 }, totalMs: 1 }]
    expect(medianTimings(jobs, { 'c.js': 500, 'old.js': 9 }, 2)).toEqual({ 'a.js': 1100, 'b.js': 100, 'c.js': 500, 'old.js': 9 })
  })
})
