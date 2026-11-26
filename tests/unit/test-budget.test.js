// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  FILE_LIMIT_MS,
  FILE_LIMIT_OVERRIDES,
  SHARD_TOTAL_LIMIT_MS,
  TOTAL_LIMIT_MS,
  fileDurations,
  parseShard,
  violations
} from '../../scripts/test-budget.mjs'
import TestBudgetReporter from '../../scripts/test-budget-reporter.mjs'

describe('test budget', () => {
  it('flags a file over the default limit', () => {
    const problems = violations([{ file: 'tests/api/other.test.js', ms: FILE_LIMIT_MS + 1 }], 0)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('tests/api/other.test.js')
  })

  it('applies the per-file override to migrate.test.js instead of the default limit', () => {
    const file = 'tests/api/migrate.test.js'
    const limit = FILE_LIMIT_OVERRIDES[file]
    expect(limit).toBeGreaterThan(FILE_LIMIT_MS)
    // Over the default but under the override: allowed.
    expect(violations([{ file, ms: FILE_LIMIT_MS + 1 }], 0)).toEqual([])
    // Over the override: reported with the override as the limit.
    const problems = violations([{ file, ms: limit + 1 }], 0)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain(`limit ${limit} ms`)
  })

  it.each(['tests/api/migrate.test.js', 'tests/api/oauth-migration.test.js'])(
    'gives %s a 7000 ms limit',
    (file) => {
      expect(FILE_LIMIT_OVERRIDES[file]).toBe(7000)
      expect(violations([{ file, ms: FILE_LIMIT_MS + 1 }], 0)).toEqual([])
      expect(violations([{ file, ms: 7000 }], 0)).toEqual([])
      const problems = violations([{ file, ms: 7001 }], 0)
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain('limit 7000 ms')
    }
  )

  it('passes a total exactly at the limit and flags one millisecond more', () => {
    expect(violations([], TOTAL_LIMIT_MS)).toEqual([])
    const problems = violations([], TOTAL_LIMIT_MS + 1)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain(`limit ${TOTAL_LIMIT_MS} ms`)
  })

  it('names the slowest files when the total is over', () => {
    const durations = [
      { file: 'tests/api/a.test.js', ms: 900 },
      { file: 'tests/api/b.test.js', ms: 800 },
      { file: 'tests/api/c.test.js', ms: 700 },
      { file: 'tests/api/d.test.js', ms: 600 }
    ]
    const [problem] = violations(durations, TOTAL_LIMIT_MS + 1)
    expect(problem).toContain('slowest: tests/api/a.test.js 900 ms, tests/api/b.test.js 800 ms, tests/api/c.test.js 700 ms')
    expect(problem).not.toContain('d.test.js')
  })

  it('reads --shard=n/m and rejects anything else', () => {
    expect(parseShard([])).toBeNull()
    expect(parseShard(['--other'])).toBeNull()
    expect(parseShard(['--shard=1/2'])).toBe('1/2')
    expect(parseShard(['--shard=2/2'])).toBe('2/2')
    for (const bad of ['--shard=0/2', '--shard=3/2', '--shard=1', '--shard=a/2', '--shard']) {
      expect(() => parseShard([bad])).toThrow(/bad --shard/)
    }
  })

  it('gives a shard its own total limit, lower than the whole-suite limit', () => {
    expect(SHARD_TOTAL_LIMIT_MS).toBe(52000)
    expect(SHARD_TOTAL_LIMIT_MS).toBeLessThan(TOTAL_LIMIT_MS)
    // A shard's total is checked against the shard limit, and reported with it.
    const problems = violations([], SHARD_TOTAL_LIMIT_MS + 1, SHARD_TOTAL_LIMIT_MS)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain(`limit ${SHARD_TOTAL_LIMIT_MS} ms`)
    expect(violations([], SHARD_TOTAL_LIMIT_MS, SHARD_TOTAL_LIMIT_MS)).toEqual([])
    // Without a shard the whole-suite limit still applies: 46 s is within it.
    expect(violations([], SHARD_TOTAL_LIMIT_MS + 1)).toEqual([])
  })

  it('turns absolute paths and fractional milliseconds into relative paths and whole numbers, slowest first', () => {
    const rows = [
      { file: '/repo/tests/api/a.test.js', ms: 120.4 },
      { file: '/repo/tests/unit/b.test.js', ms: 900.6 }
    ]
    expect(fileDurations(rows, '/repo')).toEqual([
      { file: 'tests/unit/b.test.js', ms: 901 },
      { file: 'tests/api/a.test.js', ms: 120 }
    ])
  })

  it('reporter writes one row per module, using the diagnostic duration (hooks included)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xt-budget-reporter-'))
    const out = join(dir, 'rows.json')
    const previous = process.env.TEST_BUDGET_OUT
    process.env.TEST_BUDGET_OUT = out
    try {
      const reporter = new TestBudgetReporter()
      reporter.onTestModuleEnd({ moduleId: '/repo/tests/api/x.test.js', diagnostic: () => ({ duration: 1234.4 }) })
      reporter.onTestRunEnd()
      expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual([{ file: '/repo/tests/api/x.test.js', ms: 1234.4 }])
    } finally {
      if (previous === undefined) delete process.env.TEST_BUDGET_OUT
      else process.env.TEST_BUDGET_OUT = previous
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
