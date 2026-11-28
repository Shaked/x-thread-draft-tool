// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

// Guard for speed task S2 (#312): the unit tests run in four shards (#634), and the job named
// "Unit tests (vitest)" is the one branch protection reads. It must never be skipped and must
// fail unless every job it needs succeeded.
const WORKFLOW = readFileSync(new URL('../../.github/workflows/tests.yml', import.meta.url), 'utf8')

// The text of one top-level job: from its `  <id>:` line to the next job key.
function jobBlock(id) {
  const lines = WORKFLOW.split('\n')
  const start = lines.indexOf(`  ${id}:`)
  expect(start, `job ${id} exists`).toBeGreaterThan(-1)
  const end = lines.findIndex((l, i) => i > start && /^ {2}[a-z][\w-]*:$/.test(l))
  return lines.slice(start, end === -1 ? undefined : end).join('\n')
}

describe('tests workflow: unit tests run in four shards behind one required check', () => {
  it('keeps the required check name on the aggregate job', () => {
    expect(jobBlock('unit')).toMatch(/^ {4}name: Unit tests \(vitest\)$/m)
  })

  it('makes the aggregate job wait for the checks and every shard, and never skip it', () => {
    const block = jobBlock('unit')
    expect(block).toMatch(/^ {4}needs: \[checks, unit-shard\]$/m)
    expect(block).toMatch(/^ {4}if: always\(\)$/m)
    expect(block).toMatch(/exit 1/)
  })

  it('runs the test budget in four shards, each one passing its shard flag', () => {
    const block = jobBlock('unit-shard')
    expect(block).toMatch(/^ {6}matrix:\n\s{8}shard: \[1, 2, 3, 4\]$/m)
    expect(block).toMatch(/npm run test:budget -- --shard=\$\{\{ matrix\.shard \}\}\/4/)
  })

  it('keeps the static checks in their own job', () => {
    const block = jobBlock('checks')
    for (const command of ['npm run lint', 'npm run knip', 'npm run slop', 'npm run dup']) {
      expect(block).toContain(command)
    }
    expect(block).toContain('Lint database migrations')
  })

  it('runs E2E in three shards behind the required check, never skipped', () => {
    const agg = jobBlock('e2e')
    expect(agg).toMatch(/^ {4}name: E2E tests \(playwright\)$/m)
    expect(agg).toMatch(/^ {4}needs: \[e2e-shard\]$/m)
    expect(agg).toMatch(/^ {4}if: always\(\)$/m)
    expect(agg).toMatch(/exit 1/)
    const shard = jobBlock('e2e-shard')
    expect(shard).toMatch(/^ {6}matrix:\n\s{8}shard: \[1, 2, 3\]$/m)
    expect(shard).toMatch(/npm run test:e2e -- --shard=\$\{\{ matrix\.shard \}\}\/3/)
  })
})
