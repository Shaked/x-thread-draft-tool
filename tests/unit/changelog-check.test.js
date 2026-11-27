// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { changedBatches, checkBatches, checkChanges } from '../../scripts/changelog-check.mjs'
import { rewriteText } from '../../scripts/changelog-rewrite.mjs'

const good = '# Faster saves\n- A draft opens sooner.\n\nArea: Speed\nLink: https://x.test/pull/9\n'
const bad = '# Faster saves\n- Fixed in #359.\n'
const texts = { 'docs/changelogs/20261125-100000-good.md': good, 'docs/changelogs/20261125-100001-bad.md': bad }
const readText = (path) => texts[path]

describe('checkChanges', () => {
  it('passes an added entry that has the new shape', () => {
    expect(checkChanges('A\tdocs/changelogs/20261125-100000-good.md\n', readText)).toEqual([])
  })

  it('fails an added entry that breaks the changelog lint', () => {
    const findings = checkChanges('A\tdocs/changelogs/20261125-100001-bad.md\n', readText)
    expect(findings).toContain('docs/changelogs/20261125-100001-bad.md line 2: internal-label: plain words only: no issue numbers, task ids or code')
    expect(findings).toContain('docs/changelogs/20261125-100001-bad.md line 1: shape: write one "Area:" line')
  })

  it('fails a change to or deletion of an existing entry, but not the README', () => {
    const findings = checkChanges('M\tdocs/changelogs/20260504-074500-old.md\nD\tdocs/changelogs/20260504-074501-gone.md\nM\tdocs/changelogs/README.md\n', readText)
    expect(findings).toEqual([
      'docs/changelogs/20260504-074500-old.md: an existing entry may not change or be deleted (git status M)',
      'docs/changelogs/20260504-074501-gone.md: an existing entry may not change or be deleted (git status D)'
    ])
  })

  it('ignores files outside docs/changelogs', () => {
    expect(checkChanges('M\tscripts/build-info.mjs\nA\tdocs/plans/x.md\n', readText)).toEqual([])
  })
})

describe('checkChanges with a passing batch', () => {
  it('allows a change to an existing entry that a passing batch rewrites, and still refuses a deletion', () => {
    const covered = new Set(['docs/changelogs/20260504-074500-old.md'])
    const findings = checkChanges(
      'M\tdocs/changelogs/20260504-074500-old.md\nD\tdocs/changelogs/20260504-074501-gone.md\n',
      readText,
      { covered }
    )
    expect(findings).toEqual(['docs/changelogs/20260504-074501-gone.md: an existing entry may not change or be deleted (git status D)'])
  })
})

describe('changedBatches', () => {
  it('lists the batch files a pull request adds or changes, not deleted ones', () => {
    expect(
      changedBatches('A\tdocs/changelog-rewrites/batch-01.json\nM\tdocs/changelog-rewrites/batch-02.json\nD\tdocs/changelog-rewrites/batch-03.json\nA\tdocs/changelogs/x.md\n')
    ).toEqual(['docs/changelog-rewrites/batch-01.json', 'docs/changelog-rewrites/batch-02.json'])
  })
})

describe('checkBatches', () => {
  const old = 'docs/changelogs/20260504-074500-old.md'
  const fresh = 'docs/changelogs/20261112-120000-fresh.md'
  const original = '# Faster saves\n- A draft opens sooner.\n'
  const batchOf = (file, title) => JSON.stringify([{ file, pr: 'https://github.com/Shaked/x-thread-draft-tool/pull/9', area: 'Speed', title, lines: ['A draft opens sooner.'] }])
  const readOriginal = () => original

  it('covers the entries of a passing batch only, and reports the findings of a failing one', () => {
    const good = batchOf(fresh, 'Drafts open sooner')
    const readText = (path) => (path === fresh ? rewriteText(original, JSON.parse(good)[0]) : null)
    const passing = checkBatches(['docs/changelog-rewrites/batch-01.json'], () => good, readText, readOriginal)
    expect(passing.findings).toEqual([])
    expect([...passing.covered]).toEqual([fresh])

    const bad = batchOf(fresh, 'Fixed in #359')
    const failing = checkBatches(['docs/changelog-rewrites/batch-02.json'], () => bad, readText, readOriginal)
    expect(failing.covered.size).toBe(0)
    expect(failing.findings.length).toBeGreaterThan(0)
    expect(failing.findings.every((f) => f.startsWith('docs/changelog-rewrites/batch-02.json: '))).toBe(true)
  })

  it('reports a batch that is not valid JSON and covers nothing', () => {
    const result = checkBatches(['docs/changelog-rewrites/batch-03.json'], () => '[oops', () => null, readOriginal)
    expect(result.covered.size).toBe(0)
    expect(result.findings[0]).toMatch(/^docs\/changelog-rewrites\/batch-03\.json: not valid JSON/)
  })

  it('still fails a change to an entry that no passing batch covers', () => {
    const findings = checkChanges(`M\t${old}\n`, () => '', { covered: new Set([fresh]) })
    expect(findings).toEqual([`${old}: an existing entry may not change or be deleted (git status M)`])
  })
})
