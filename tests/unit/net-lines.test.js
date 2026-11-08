import { describe, expect, it } from 'vitest'
import { countNetLines, evaluate, isCounted } from '../../scripts/net-lines.mjs'

const PLAN_BODY = 'Implements docs/plans/post-migration-hardening.md Task 3.5'

describe('net-lines counting', () => {
  it('sums added and removed lines under the counted directories', () => {
    const numstat = ['10\t2\tsrc/a.js', '3\t1\tserver/b.js', '4\t0\tapi/c.js', '1\t1\tscripts/d.mjs'].join('\n')
    expect(countNetLines(numstat)).toEqual({ added: 18, removed: 4 })
  })

  it('excludes tests, docs, lockfiles and other paths', () => {
    expect(isCounted('src/a.test.js')).toBe(false)
    expect(isCounted('src/components/b.test.jsx')).toBe(false)
    expect(isCounted('tests/unit/c.js')).toBe(false)
    expect(isCounted('docs/plans/x.md')).toBe(false)
    expect(isCounted('package-lock.json')).toBe(false)
    expect(isCounted('README.md')).toBe(false)
    expect(isCounted('src/a.js')).toBe(true)
  })

  it('counts binary files as zero and ignores excluded paths', () => {
    const numstat = ['-\t-\tsrc/logo.png', '5\t0\tdocs/x.md', '2\t2\tsrc/a.test.js'].join('\n')
    expect(countNetLines(numstat)).toEqual({ added: 0, removed: 0 })
  })

  it('handles blank lines and empty input', () => {
    expect(countNetLines('')).toEqual({ added: 0, removed: 0 })
    expect(countNetLines('\n\n1\t0\tsrc/a.js\n\n')).toEqual({ added: 1, removed: 0 })
  })
})

describe('net-lines evaluation', () => {
  it('passes when added lines do not exceed removed lines', () => {
    expect(evaluate({ numstat: '5\t5\tsrc/a.js' }).pass).toBe(true)
    expect(evaluate({ numstat: '2\t9\tserver/a.js' }).pass).toBe(true)
  })

  it('fails when added lines exceed removed lines without a plan reference', () => {
    const result = evaluate({ numstat: '6\t5\tsrc/a.js', body: 'Adds a feature' })
    expect(result.pass).toBe(false)
    expect(result.added).toBe(6)
    expect(result.removed).toBe(5)
  })

  it('passes a growing change when the body references a plan task', () => {
    expect(evaluate({ numstat: '40\t0\tsrc/a.js', body: PLAN_BODY }).pass).toBe(true)
  })

  it('does not accept a plan reference without a task number', () => {
    expect(evaluate({ numstat: '40\t0\tsrc/a.js', body: 'See docs/plans/post-migration-hardening.md' }).pass).toBe(false)
  })

  it('explains both counts and the reason', () => {
    const result = evaluate({ numstat: '3\t1\tsrc/a.js', body: '' })
    expect(result.reason).toMatch(/plan task/)
    expect(result.added).toBe(3)
    expect(result.removed).toBe(1)
  })
})
