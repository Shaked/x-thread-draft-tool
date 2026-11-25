// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { checkChanges } from '../../scripts/changelog-check.mjs'

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
