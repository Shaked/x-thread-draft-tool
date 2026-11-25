// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { changelogEntries } from '../../scripts/build-info.mjs'

const file = (name, text) => ({ name, text })

describe('changelogEntries', () => {
  it('takes id and UTC date from the name, and the first heading as title', () => {
    const [entry] = changelogEntries([file('20261107-134726-vercel-migration-plan.md', '# Vercel plan\n\nMove the app.\n')])
    expect(entry).toEqual({
      id: '20261107-134726-vercel-migration-plan',
      date: '2026-11-07T13:47:26Z',
      title: 'Vercel plan',
      summary: 'Move the app.',
      area: null,
      link: null,
      details: ''
    })
  })

  it('reads Area and Link, keeps them out of the summary, and returns the text under Technical details', () => {
    const text = [
      '# Drafts save faster',
      '',
      'A draft opens in less than a second.',
      '',
      'Area: Speed',
      'Link: https://github.com/Shaked/x-thread-draft-tool/pull/430',
      '',
      '## Technical details',
      '',
      'Fixed T7 in `server/x.js`. Area: nothing here.'
    ].join('\n')
    const [entry] = changelogEntries([file('20261125-100000-faster.md', text)])
    expect(entry).toEqual({
      id: '20261125-100000-faster',
      date: '2026-11-25T10:00:00Z',
      title: 'Drafts save faster',
      summary: 'A draft opens in less than a second.',
      area: 'Speed',
      link: 'https://github.com/Shaked/x-thread-draft-tool/pull/430',
      details: 'Fixed T7 in `server/x.js`. Area: nothing here.'
    })
  })

  it('gives a null area and link when the lines are missing, and drops a link that is not https', () => {
    const [entry] = changelogEntries([file('20261125-100001-x.md', '# X\n\nLink: http://insecure.test\n')])
    expect(entry).toMatchObject({ area: null, link: null, details: '', summary: '' })
  })

  it('reads indented Area and Link lines, as the lint does', () => {
    const [entry] = changelogEntries([file('20261125-100002-indent.md', '# I\n\n- Works.\n\n  Area: Admin\n  Link: https://x.test/pull/3\n')])
    expect(entry).toMatchObject({ area: 'Admin', link: 'https://x.test/pull/3', summary: 'Works.' })
  })

  it('reads an old multi-section file: headings skipped, bullets and text lines used, at most three', () => {
    const text = '# Old thing\n\n## Context\n\nSome text here.\n\n## Changes\n\n- one\n- two\n- three\n- four is not used\n'
    const [entry] = changelogEntries([file('20260504-074800-old.md', text)])
    expect(entry.title).toBe('Old thing')
    expect(entry.summary).toBe('Some text here. one two')
  })

  it('strips an internal label, reduces links to their text and removes backticks', () => {
    const text = '# New\n\n- T6: the list now has [docs](https://example.com/x) and `code`\n- second line\n'
    const [entry] = changelogEntries([file('20261113-000000-new.md', text)])
    expect(entry.summary).toBe('the list now has docs and code second line')
  })

  it('strips D-14 and P-CODEX style labels, but keeps a word that is not a label', () => {
    const entries = changelogEntries([
      file('20261113-000001-a.md', '# A\n\n- D-14: first\n'),
      file('20261113-000002-b.md', '# B\n\n- P-CODEX: second\n'),
      file('20261113-000003-c.md', '# C\n\n- API: third\n')
    ])
    expect(entries.map((e) => e.summary)).toEqual(['API: third', 'second', 'first'])
  })

  it('keeps Hebrew byte for byte and normalises to NFC', () => {
    const hebrew = 'שלום עולם, איזו גרסה'
    const [entry] = changelogEntries([file('20261113-000004-he.md', `# עברית\n\n${hebrew}\n`)])
    expect(entry.title).toBe('עברית')
    expect(entry.summary).toBe(hebrew)
    const [decomposed] = changelogEntries([file('20261113-000005-nfc.md', '# x\n\ncafé\n')])
    expect(decomposed.summary).toBe('café')
  })

  it('caps the summary at 280 characters, cut at a word boundary', () => {
    const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ')
    const [entry] = changelogEntries([file('20261113-000006-long.md', `# Long\n\n${long}\n`)])
    expect([...entry.summary].length).toBeLessThanOrEqual(280)
    expect(entry.summary.endsWith('…')).toBe(true)
    expect(long.startsWith(entry.summary.slice(0, -1))).toBe(true)
    expect(entry.summary.slice(0, -1)).toMatch(/word\d+$/)
  })

  it('caps a single 600-character word too, with no word boundary to use', () => {
    const [entry] = changelogEntries([file('20261113-000007-word.md', `# W\n\n${'a'.repeat(600)}\n`)])
    expect([...entry.summary].length).toBe(280)
  })

  it('skips README.md and other non-markdown files, and sorts newest first', () => {
    const entries = changelogEntries([
      file('README.md', '# Readme\n'),
      file('notes.txt', 'nope'),
      file('20261107-000000-older.md', '# Older\n\nx\n'),
      file('20261113-000000-newer.md', '# Newer\n\ny\n')
    ])
    expect(entries.map((e) => e.id)).toEqual(['20261113-000000-newer', '20261107-000000-older'])
  })

  it('gives a null date and title when the name or heading is missing', () => {
    const [entry] = changelogEntries([file('plain-name.md', 'Only text.\n')])
    expect(entry).toEqual({ id: 'plain-name', date: null, title: null, summary: 'Only text.', area: null, link: null, details: '' })
  })
})

describe('the real docs/changelogs', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'changelogs')
  const names = readdirSync(dir).filter((name) => name.endsWith('.md') && name !== 'README.md')
  const entries = changelogEntries(names.map((name) => file(name, readFileSync(join(dir, name), 'utf8'))))

  it('parses every file, one entry each, with a non-empty summary (guards future file formats)', () => {
    expect(entries).toHaveLength(names.length)
    for (const entry of entries) {
      expect(entry.summary, entry.id).not.toBe('')
      expect([...entry.summary].length, entry.id).toBeLessThanOrEqual(280)
    }
  })

  it('has a UTC date for every file name', () => {
    expect(entries.filter((entry) => entry.date === null)).toEqual([])
  })
})
