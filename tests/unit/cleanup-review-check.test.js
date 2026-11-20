// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  planCleanupReview,
  relevantFiles,
  clipList,
  fence,
  parseCommits,
  buildBody,
  EMPTY_TREE,
  MAX_COMMITS,
  MAX_FILES,
} from '../../scripts/cleanup-review-check.mjs'

const HEAD = 'h'.repeat(40)
const LAST = 'l'.repeat(40)
const BASE = 'b'.repeat(40)

// Fake git: answers by the first argument. `log` and `diff` return the given text; `rev-parse`
// returns `base` (empty = missing ref, like a repository with fewer than 21 commits).
function fakeGit({ log = '', diff = '', base = BASE } = {}) {
  const calls = []
  const git = (args) => {
    calls.push(args)
    if (args[0] === 'rev-parse') {
      if (!base) throw new Error('fatal: ambiguous argument')
      return `${base}\n`
    }
    if (args[0] === 'log') return log
    if (args[0] === 'diff') return diff
    throw new Error(`unexpected git call ${args.join(' ')}`)
  }
  return { git, calls }
}

const LOG_TWO = 'aaa1111\tFix the thing\nbbb2222\tAdd a test\n'

describe('relevantFiles', () => {
  it('drops changelog entries and keeps everything else', () => {
    expect(relevantFiles(['docs/changelogs/20261120-010000-x.md', 'src/a.js', 'docs/operations/x.md'])).toEqual([
      'src/a.js',
      'docs/operations/x.md',
    ])
  })
})

describe('planCleanupReview', () => {
  it('does nothing when the tag already points at HEAD', () => {
    const { git, calls } = fakeGit()
    const plan = planCleanupReview({ last: HEAD, head: HEAD, git })
    expect(plan.action).toBe('nochange')
    expect(plan.moveTag).toBe(false)
    expect(plan.message).toBe('no changes: nothing to do')
    expect(calls).toHaveLength(0)
  })

  it('moves the tag and creates nothing when only changelog files changed', () => {
    const { git } = fakeGit({ log: 'ccc3333\tAdd changelog\n', diff: 'docs/changelogs/20261120-010000-x.md\n' })
    const plan = planCleanupReview({ last: LAST, head: HEAD, git })
    expect(plan.action).toBe('changelog-only')
    expect(plan.moveTag).toBe(true)
    expect(plan.message).toBe('only changelog changes: nothing to do')
    expect(plan.title).toBeUndefined()
    expect(plan.body).toBeUndefined()
  })

  it('creates one issue plan when there are changes', () => {
    const { git } = fakeGit({ log: LOG_TWO, diff: 'src/a.js\ndocs/changelogs/x.md\ntests/unit/a.test.js\n' })
    const plan = planCleanupReview({ last: LAST, head: HEAD, git, date: '2026-11-20' })
    expect(plan.action).toBe('create')
    expect(plan.moveTag).toBe(true)
    expect(plan.title).toBe('Cleanup review 2026-11-20')
    expect(plan.files).toEqual(['src/a.js', 'tests/unit/a.test.js'])
    expect(plan.commits).toEqual([
      { sha: 'aaa1111', title: 'Fix the thing' },
      { sha: 'bbb2222', title: 'Add a test' },
    ])
    expect(plan.body).toContain('aaa1111 Fix the thing')
    expect(plan.body).toContain('Rules: docs/operations/cleanup-review.md')
  })

  it('creates nothing and keeps the tag when a cleanup issue is still open', () => {
    const { git } = fakeGit({ log: LOG_TWO, diff: 'src/a.js\n' })
    const plan = planCleanupReview({ last: LAST, head: HEAD, git, openCleanupIssues: 1 })
    expect(plan.action).toBe('still-open')
    expect(plan.moveTag).toBe(false)
    expect(plan.message).toBe('previous cleanup review still open')
    expect(plan.title).toBeUndefined()
  })

  it('still moves the tag for changelog-only changes while a cleanup issue is open', () => {
    const { git } = fakeGit({ log: LOG_TWO, diff: 'docs/changelogs/x.md\n' })
    const plan = planCleanupReview({ last: LAST, head: HEAD, git, openCleanupIssues: 2 })
    expect(plan.action).toBe('changelog-only')
    expect(plan.moveTag).toBe(true)
  })

  it('on the first run uses the last 20 commits (head~20..head)', () => {
    const { git, calls } = fakeGit({ log: LOG_TWO, diff: 'src/a.js\n' })
    const plan = planCleanupReview({ last: '', head: HEAD, git })
    expect(plan.action).toBe('create')
    expect(calls).toContainEqual(['rev-parse', '-q', '--verify', `${HEAD}~20`])
    expect(calls).toContainEqual(['log', '--format=%h%x09%s', `${BASE}..${HEAD}`])
    expect(calls).toContainEqual(['diff', '--name-only', '--no-renames', BASE, HEAD])
  })

  it('on the first run in a short repository diffs against the empty tree', () => {
    const { git, calls } = fakeGit({ log: LOG_TWO, diff: 'src/a.js\n', base: '' })
    planCleanupReview({ last: '', head: HEAD, git })
    expect(calls).toContainEqual(['log', '--format=%h%x09%s', '-n', '20', HEAD])
    expect(calls).toContainEqual(['diff', '--name-only', '--no-renames', EMPTY_TREE, HEAD])
  })

  it('requires a head sha', () => {
    expect(() => planCleanupReview({ last: LAST, head: '', git: fakeGit().git })).toThrow('head is required')
  })

  it('puts the template before the generated lists when it exists', () => {
    const { git } = fakeGit({ log: LOG_TWO, diff: 'src/a.js\n' })
    const plan = planCleanupReview({ last: LAST, head: HEAD, git, template: '# Template text\n' })
    expect(plan.body.startsWith('# Template text')).toBe(true)
  })

  it('cuts very long commit and file lists', () => {
    const many = Array.from({ length: 35 }, (_, i) => `c${i}\ttitle ${i}`).join('\n')
    const files = Array.from({ length: 120 }, (_, i) => `src/f${i}.js`).join('\n')
    const { git } = fakeGit({ log: many, diff: files })
    const plan = planCleanupReview({ last: LAST, head: HEAD, git })
    expect(plan.commits).toHaveLength(35)
    expect(plan.body).toContain('Commits since the last review: 35 (first 30 shown)')
    expect(plan.body).toContain('and 5 more')
    expect(plan.body).toContain('and 20 more')
    expect(plan.body).toContain('Changed files (docs/changelogs/ not counted): 120')
    expect(plan.body).not.toContain('src/f100.js')
    expect(plan.body).toContain('src/f99.js')
  })
})

describe('helpers', () => {
  it('clipList keeps short lists whole and adds a count line for long ones', () => {
    expect(clipList(['a', 'b'], 3)).toEqual(['a', 'b'])
    expect(clipList(['a', 'b', 'c', 'd'], 2)).toEqual(['a', 'b', 'and 2 more'])
    expect(MAX_COMMITS).toBe(30)
    expect(MAX_FILES).toBe(100)
  })

  it('fence turns backticks into apostrophes so a title cannot close the block', () => {
    const out = fence(['abc1234 close ``` and @someone'])
    expect(out.split('\n')[0]).toBe('```text')
    expect(out.split('\n').at(-1)).toBe('```')
    expect(out).not.toContain('``` and')
  })

  it('parseCommits reads the sha and keeps tabs inside the title', () => {
    expect(parseCommits('abc\tone\ttwo\n\n')).toEqual([{ sha: 'abc', title: 'one\ttwo' }])
  })

  it('buildBody without commits or files still lists the rules line', () => {
    const body = buildBody({ commits: [], totalCommits: 0, files: [], totalFiles: 0 })
    expect(body).toContain('Commits since the last review: 0')
    expect(body).toContain('Rules: docs/operations/cleanup-review.md')
  })
})
