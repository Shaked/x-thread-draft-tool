import { describe, expect, it } from 'vitest'
import { MARKDOWN_LIMIT, draftsTable, escapeCell, exportBlock, fenceFor, fenced, imageLink, shareLine, tweetLink } from '../../server/mcp/render/markdown.js'
import { threadText } from '../../server/mcp/thread-text.js'

const BLOB = 'https://abc123.public.blob.vercel-storage.com'

describe('markdown for AI apps (#293)', () => {
  it('sizes the fence over the longest backtick run', () => {
    expect(fenceFor('plain')).toBe('```')
    expect(fenceFor('a ``` b')).toBe('````')
    expect(fenceFor('a `````  b')).toBe('``````')
    const text = 'x ``` y ````` z'
    expect(fenced(text)).toBe('``````text\n' + text + '\n``````')
  })

  it('escapes a title so a link in it is not markdown', () => {
    expect(escapeCell('[x](http://e)')).toBe('\\[x\\]\\(http://e\\)')
    expect(escapeCell('[](http://e)')).toBe('\\[\\]\\(http://e\\)')
    expect(escapeCell('a | b\nc‮')).toBe('a \\| b c')
    expect(escapeCell('')).toBe('Untitled draft')
  })

  it('shows an image only for the Blob origin', () => {
    expect(imageLink(`${BLOB}/a.png`, BLOB)).toBe(`${BLOB}/a.png`)
    expect(imageLink('https://evil.example/a.png', BLOB)).toBe('image')
    expect(imageLink(`${BLOB}.evil.example/a.png`, BLOB)).toBe('image')
    expect(imageLink(`${BLOB}/a.png`, null)).toBe('image')
  })

  it('links a tweet only for the status pattern', () => {
    expect(tweetLink('https://x.com/user_1/status/123')).toBe('https://x.com/user_1/status/123')
    expect(tweetLink('https://twitter.com/user/status/9')).toBeTruthy()
    for (const bad of ['http://x.com/u/status/1', 'https://x.com/u/status/1?x=1', 'https://evil.com/u/status/1', 'https://x.com/u/status/1 foo', null]) {
      expect(tweetLink(bad)).toBeNull()
    }
  })

  it('builds the drafts table and caps its size', () => {
    const table = draftsTable([{ id: 'abc-1', title: 'Hi [x](http://e)', post_count: 2, is_published: false, updated_at: '2026-11-27T10:00:00Z' }], 'https://app.test')
    expect(table.split('\n')[0]).toBe('| Title | Posts | State | Updated | Editor |')
    expect(table).toContain('| Hi \\[x\\]\\(http://e\\) | 2 | draft | 2026-11-27 | https://app.test/draft/abc-1 |')
    expect(draftsTable([], 'https://app.test')).toBe('No drafts.')
    const many = Array.from({ length: 400 }, (_, i) => ({ id: `a${i}`, title: 'T'.repeat(40), post_count: 1 }))
    const big = draftsTable(many, 'https://app.test')
    expect(big.length).toBeLessThanOrEqual(MARKDOWN_LIMIT)
    expect(big).toMatch(/\.\.\. \d+ more drafts: https:\/\/app\.test\/$/)
  })

  it('puts an export in a fence and keeps Hebrew bytes', () => {
    const he = 'שלום ``` עולם'
    const block = exportBlock(he, 'text')
    expect(block).toBe('````text\n' + he + '\n````')
    expect(exportBlock('{}', 'json').startsWith('```json\n')).toBe(true)
    expect(exportBlock('x'.repeat(20000), 'text').length).toBeLessThanOrEqual(MARKDOWN_LIMIT)
  })

  it('names the share link and its expiry', () => {
    const text = shareLine({ preview_url: 'https://a/p', markdown_url: 'https://a/m', expires_at: '2026-11-28T00:00:00Z', one_time: true })
    expect(text).toContain('expires 2026-11-28T00:00:00Z')
    expect(text).toContain('https://a/p')
  })

  it('cuts a long thread with a count and the editor url', () => {
    const posts = Array.from({ length: 60 }, (_, i) => `post ${i} ` + 'w'.repeat(250))
    const text = threadText({ title: 'T', posts, url: 'https://app.test/draft/1', saved: true })
    expect(text.length).toBeLessThanOrEqual(MARKDOWN_LIMIT)
    expect(text).toMatch(/\.\.\. \d+ more posts: https:\/\/app\.test\/draft\/1/)
  })

  it('leaves a quoted tweet that does not match out of a thread', () => {
    const text = threadText({ title: 'T', posts: [{ text: 'a', embeddedTweet: 'https://evil.com/x' }], saved: false })
    expect(text).not.toContain('Quoted post')
  })
})
