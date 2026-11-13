import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  FILE_LIMIT_MS,
  FILE_LIMIT_OVERRIDES,
  TOTAL_LIMIT_MS,
  fileDurations,
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
