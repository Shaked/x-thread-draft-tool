// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkBatch, inWindow, originalFromGit, originalOf, planBatch, rewriteText } from '../../scripts/changelog-rewrite.mjs'

const file = 'docs/changelogs/20261112-120000-old-thing.md'
const original = '# Faster saves\n- A draft opens sooner.\n- Fixed in #359.\n'
const entry = {
  file,
  pr: 'https://github.com/Shaked/x-thread-draft-tool/pull/359',
  area: 'Speed',
  title: 'Drafts open sooner',
  lines: ['A draft opens sooner.']
}

/** A small in-memory repository: path -> text. */
const repo = (files) => (path) => (path in files ? files[path] : null)

describe('rewriteText', () => {
  it('puts the new title, lines, Area and Link on top and keeps the original text byte for byte', () => {
    const text = rewriteText(original, entry)
    expect(text).toBe(
      '# Drafts open sooner\n\n- A draft opens sooner.\n\nArea: Speed\nLink: https://github.com/Shaked/x-thread-draft-tool/pull/359\n\n## Technical details\n\n' +
        original
    )
    expect(originalOf(text)).toBe(original)
  })
})

describe('originalOf', () => {
  it('finds the heading only at the start of a line, so a line that mentions it does not match', () => {
    const text = rewriteText(original, { ...entry, lines: ['Read ## Technical details'] })
    expect(originalOf(text)).toBe(original)
  })
})

describe('inWindow', () => {
  it('allows entries dated from 2026-11-11 on, and refuses earlier ones and other paths', () => {
    expect(inWindow('docs/changelogs/20261111-000000-a.md')).toBe(true)
    expect(inWindow('docs/changelogs/20261110-235959-a.md')).toBe(false)
    expect(inWindow('docs/plans/a.md')).toBe(false)
    expect(inWindow('docs/changelogs/README.md')).toBe(false)
  })
})

describe('planBatch', () => {
  it('plans the change and writes nothing: the plan has the new text and the old and new titles', () => {
    const plan = planBatch([entry], repo({ [file]: original }))
    expect(plan.ok).toBe(true)
    expect(plan.changes).toEqual([
      expect.objectContaining({ file, from: original, to: rewriteText(original, entry), oldTitle: 'Faster saves', newTitle: 'Drafts open sooner' })
    ])
  })

  it('stops the whole batch when one entry fails the lint, and plans no change for the others', () => {
    const other = 'docs/changelogs/20261112-130000-other.md'
    const bad = { ...entry, file: other, title: 'Fixed in #359' }
    const plan = planBatch([entry, bad], repo({ [file]: original, [other]: '# Other\n- Text.\n' }))
    expect(plan.ok).toBe(false)
    expect(plan.findings.some((f) => f.startsWith(`${other}: line 1: internal-label`))).toBe(true)
  })

  it('refuses an entry dated before the window, a missing file, a duplicate and an entry in the new shape', () => {
    const early = { ...entry, file: 'docs/changelogs/20261110-120000-early.md' }
    const missing = { ...entry, file: 'docs/changelogs/20261112-140000-missing.md' }
    const newShape = 'docs/changelogs/20261112-150000-new.md'
    const plan = planBatch(
      [early, missing, entry, entry, { ...entry, file: newShape }],
      repo({ [file]: original, [early.file]: original, [newShape]: '# New\n- Text.\n\nArea: Speed\nLink: https://x.test/pull/1\n' })
    )
    expect(plan.ok).toBe(false)
    expect(plan.findings).toEqual(
      expect.arrayContaining([
        `${early.file}: dated before 20261111, outside the rewrite window`,
        `${missing.file}: file not found`,
        `${file}: listed twice in the batch`,
        `${newShape}: already has the new shape, and differs from this batch`
      ])
    )
  })

  it('refuses a batch that is not a list', () => {
    expect(planBatch({ file }, repo({})).ok).toBe(false)
  })

  it('is idempotent: a file already written by this batch plans no change', () => {
    const written = rewriteText(original, entry)
    const plan = planBatch([entry], repo({ [file]: written }))
    expect(plan.ok).toBe(true)
    expect(plan.changes).toEqual([])
  })
})

describe('checkBatch', () => {
  it('passes when each file is what the batch makes from its original text', () => {
    const result = checkBatch([entry], repo({ [file]: rewriteText(original, entry) }), () => original)
    expect(result).toEqual({ ok: true, findings: [] })
  })

  it('fails when the file differs from the batch, or its original text is not the one committed', () => {
    const differs = checkBatch([entry], repo({ [file]: rewriteText(original, entry) + 'edited\n' }), () => original)
    expect(differs.findings).toEqual([`${file}: the file differs from what --write of this batch makes`])
    const noOriginal = checkBatch([entry], repo({ [file]: original }), () => {
      throw new Error('no commit adds it')
    })
    expect(noOriginal.findings).toEqual([`${file}: no original text (no commit adds it)`])
  })
})

describe('originalFromGit', () => {
  // Two real shapes from the changelog history (issue #369, steps 3 and 4): an entry that a merge resolved, so the merge
  // holds its newest text before the rewrite, and an entry edited after it was added. Each must give the text the
  // rewrite starts from, and a rewritten entry must give its text before the rewrite.
  const heading = { title: 'Five entries', lines: ['Five entries can be read.'], area: 'Docs', pr: 'https://github.com/Shaked/x-thread-draft-tool/pull/1' }

  it('reads the text an entry had before its rewrite, from its own history', () => {
    const dir = mkdtempSync(join(tmpdir(), 'changelog-origin-'))
    try {
      const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.test', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' })
      const write = (name, text) => writeFileSync(join(dir, name), text)
      const commit = (message) => {
        git('add', '-A')
        git('commit', '-q', '-m', message)
      }
      git('init', '-q')
      write('base.md', 'base\n')
      commit('base')

      // both sides add the file, and the merge resolves them: the merge commit holds the text the rewrite starts from
      git('checkout', '-q', '-b', 'side')
      write('merged.md', 'side version\n')
      commit('side adds')
      git('checkout', '-q', '-')
      write('merged.md', 'main version\n')
      commit('main adds')
      expect(() => git('merge', '-q', 'side')).toThrow()
      write('merged.md', 'resolved version\n')
      commit('merge')

      write('edited.md', 'first version\n')
      commit('add')
      write('edited.md', 'edited version\n')
      commit('edit after add')

      write('rewritten.md', 'before the rewrite\n')
      commit('add rewritten')
      write('rewritten.md', rewriteText('before the rewrite\n', heading))
      commit('rewrite')

      expect(originalFromGit('merged.md', dir)).toBe('resolved version\n')
      expect(originalFromGit('edited.md', dir)).toBe('edited version\n')
      expect(originalFromGit('rewritten.md', dir)).toBe('before the rewrite\n')
      expect(() => originalFromGit('missing.md', dir)).toThrow('no committed version of missing.md')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
