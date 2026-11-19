// @vitest-environment node
// F6 (#212): a draft stored with an object post that has no id (saved before ids were required) can
// still be edited through the MCP post tools, and the saved posts all have ids afterwards. A post
// that is not an object is still refused with 400 and nothing is written. Real route(), real SQL (PGlite).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({ putBlob: vi.fn(), deleteBlobUrls: vi.fn(async () => {}) }))

import { callTool } from '../../server/mcp/tools.js'
import { setupTestDb } from './helpers/db.js'

let db
let alice

beforeAll(async () => {
  db = await setupTestDb()
})

beforeEach(async () => {
  await db.reset()
  alice = await db.insertUser({ github_id: 1, login: 'alice' })
})

const run = (name, args) => callTool(name, args, { caller: { uid: alice.id }, origin: 'https://app.test' })

const postsOf = async (id) => (await db.pg.query('select posts from drafts where id = $1', [id])).rows[0].posts

// Stored as they were before ids were required: the second post has no id.
const LEGACY = () => [
  { id: 'a', text: 'first', images: [], embeddedTweet: null },
  { text: 'no id', images: [], embeddedTweet: null },
  { id: 'c', text: 'third', images: [], embeddedTweet: null }
]

describe('MCP post tools on a draft with an id-less post', () => {
  it('remove_post on another post saves the id-less post with a new id', async () => {
    const draft = await db.insertDraft(alice.id, { posts: LEGACY() })
    const result = await run('remove_post', { id: draft.id, post_id: 'a' })
    expect(result.isError).toBe(false)

    const saved = await postsOf(draft.id)
    expect(saved).toHaveLength(2)
    expect(saved.every((post) => typeof post.id === 'string' && post.id.length > 0)).toBe(true)
    expect(saved[0]).toMatchObject({ text: 'no id' })
    expect(saved[1]).toMatchObject({ id: 'c', text: 'third' })
  })

  it('move_post can move the id-less post, which then has an id', async () => {
    const draft = await db.insertDraft(alice.id, { posts: LEGACY() })
    // Post 'a' (position 1) moves to position 2, so the id-less post, which was at position 2, moves to position 1.
    const result = await run('move_post', { id: draft.id, post_id: 'a', position: 2 })
    expect(result.isError).toBe(false)

    const saved = await postsOf(draft.id)
    expect(saved.map((post) => post.text)).toEqual(['no id', 'first', 'third'])
    expect(saved.every((post) => typeof post.id === 'string' && post.id.length > 0)).toBe(true)
  })

  it('a draft whose posts all have ids keeps the same ids after an edit', async () => {
    const posts = [
      { id: 'a', text: 'first', images: [], embeddedTweet: null },
      { id: 'b', text: 'second', images: [], embeddedTweet: null }
    ]
    const draft = await db.insertDraft(alice.id, { posts })
    const result = await run('remove_post', { id: draft.id, post_id: 'b' })
    expect(result.isError).toBe(false)
    expect(await postsOf(draft.id)).toEqual([posts[0]])
  })

  it('a post that is not an object is still refused and nothing is written', async () => {
    const stored = [{ id: 'a', text: 'first', images: [], embeddedTweet: null }, 'not an object']
    const draft = await db.insertDraft(alice.id, { posts: stored })
    const result = await run('remove_post', { id: draft.id, post_id: 'a' })
    expect(result.isError).toBe(true)
    expect(await postsOf(draft.id)).toEqual(stored)
  })
})
