import { describe, it, expect } from 'vitest'
import { FILE_LIMIT_MS, FILE_LIMIT_OVERRIDES, violations } from '../../scripts/test-budget.mjs'

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
})
