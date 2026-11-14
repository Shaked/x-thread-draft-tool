// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({
  putBlob: vi.fn(),
  deleteBlobUrls: vi.fn(async () => {})
}))

import { deleteBlobUrls } from '../../server/blob.js'
import { route } from '../../server/router.js'
import { apiRequest, setupTestDb } from './helpers/db.js'

let db
let alice
let bob
let aliceCookie
let bobCookie

// A Blob URL under the given user's own prefix
const blob = (name, uid = () => alice.id) => `https://store.public.blob.vercel-storage.com/drafts/${uid()}/d/${name}`

beforeAll(async () => {
  db = await setupTestDb()
})

beforeEach(async () => {
  await db.reset()
  vi.mocked(deleteBlobUrls).mockClear()
  alice = await db.insertUser({ github_id: 1, login: 'alice' })
  bob = await db.insertUser({ github_id: 2, login: 'bob' })
  aliceCookie = await db.cookieFor(alice)
  bobCookie = await db.cookieFor(bob)
})

afterEach(() => {
  vi.clearAllMocks()
})

const json = (res) => res.json()

describe('GET /api/drafts', () => {
  it('returns only the caller drafts, split by published flag', async () => {
    await db.insertDraft(alice.id, { title: 'mine open' })
    await db.insertDraft(alice.id, { title: 'mine done', is_published: true, published_at: new Date().toISOString() })
    await db.insertDraft(bob.id, { title: 'bobs open' })

    const open = await json(await route(apiRequest('/api/drafts?published=false', { cookie: aliceCookie })))
    expect(open.drafts.map((d) => d.title)).toEqual(['mine open'])

    const done = await json(await route(apiRequest('/api/drafts?published=true', { cookie: aliceCookie })))
    expect(done.drafts.map((d) => d.title)).toEqual(['mine done'])
  })

  it('requires a session and a valid published flag', async () => {
    expect((await route(apiRequest('/api/drafts?published=false'))).status).toBe(401)
    const bad = await route(apiRequest('/api/drafts', { cookie: aliceCookie }))
    expect(bad.status).toBe(400)
  })
})

describe('POST /api/drafts', () => {
  it('creates a draft owned by the caller', async () => {
    const res = await route(
      apiRequest('/api/drafts', {
        method: 'POST',
        cookie: aliceCookie,
        body: { title: 'New', posts: [{ id: 'p1', text: 'hi', images: [], embeddedTweet: null }] }
      })
    )
    expect(res.status).toBe(201)
    const { draft } = await json(res)
    expect(draft).toMatchObject({ title: 'New', user_id: alice.id, is_published: false })
    expect(draft.posts).toEqual([{ id: 'p1', text: 'hi', images: [], embeddedTweet: null }])
  })

  it('rejects a title over 500 characters and non-array posts', async () => {
    const longTitle = await route(
      apiRequest('/api/drafts', { method: 'POST', cookie: aliceCookie, body: { title: 'x'.repeat(501), posts: [] } })
    )
    expect(longTitle.status).toBe(400)

    const badPosts = await route(
      apiRequest('/api/drafts', { method: 'POST', cookie: aliceCookie, body: { title: 'ok', posts: 'nope' } })
    )
    expect(badPosts.status).toBe(400)
  })
})

describe('GET /api/drafts/:id', () => {
  it('is private: the owner reads the draft', async () => {
    const draft = await db.insertDraft(alice.id, { title: 'mine' })
    const res = await route(apiRequest(`/api/drafts/${draft.id}`, { cookie: aliceCookie }))
    expect(res.status).toBe(200)
    expect((await json(res)).draft).toMatchObject({ id: draft.id, title: 'mine', user_id: alice.id })
  })

  it('another signed-in user gets 404, and a signed-out visitor gets 401', async () => {
    const draft = await db.insertDraft(alice.id, { title: 'mine' })
    const other = await route(apiRequest(`/api/drafts/${draft.id}`, { cookie: bobCookie }))
    expect(other.status).toBe(404)
    expect(await json(other)).toEqual({ error: 'Draft not found' })
    expect((await route(apiRequest(`/api/drafts/${draft.id}`))).status).toBe(401)
  })

  it('returns 404 for an invalid UUID and for a missing draft', async () => {
    expect((await route(apiRequest('/api/drafts/not-a-uuid', { cookie: aliceCookie }))).status).toBe(404)
    const missing = '00000000-0000-4000-8000-000000000000'
    expect((await route(apiRequest(`/api/drafts/${missing}`, { cookie: aliceCookie }))).status).toBe(404)
  })
})

describe('owner-only writes', () => {
  it('PATCH by a non-owner returns 404 and leaves the row unchanged', async () => {
    const draft = await db.insertDraft(alice.id, { title: 'original' })
    const res = await route(
      apiRequest(`/api/drafts/${draft.id}`, { method: 'PATCH', cookie: bobCookie, body: { title: 'hacked' } })
    )
    expect(res.status).toBe(404)
    const { rows } = await db.pg.query('select title from drafts where id = $1', [draft.id])
    expect(rows[0].title).toBe('original')
  })

  it('PATCH by the owner updates title and posts', async () => {
    const draft = await db.insertDraft(alice.id, { title: 'a' })
    const res = await route(
      apiRequest(`/api/drafts/${draft.id}`, {
        method: 'PATCH',
        cookie: aliceCookie,
        body: { title: 'b', posts: [{ id: 'z', text: 'updated', images: [] }] }
      })
    )
    expect(res.status).toBe(200)
    const { draft: updated } = await json(res)
    expect(updated.title).toBe('b')
    expect(updated.posts).toEqual([{ id: 'z', text: 'updated', images: [] }])
  })

  it('PATCH with no fields is rejected', async () => {
    const draft = await db.insertDraft(alice.id)
    const res = await route(apiRequest(`/api/drafts/${draft.id}`, { method: 'PATCH', cookie: aliceCookie, body: {} }))
    expect(res.status).toBe(400)
  })

  it('never deletes Blob objects under another user prefix', async () => {
    const foreign = blob('x.png', () => bob.id)
    const draft = await db.insertDraft(alice.id, { posts: [{ id: 'p', images: [foreign] }] })
    await route(apiRequest(`/api/drafts/${draft.id}`, { method: 'DELETE', cookie: aliceCookie }))
    const deleted = vi.mocked(deleteBlobUrls).mock.calls.flatMap(([urls]) => urls)
    expect(deleted).not.toContain(foreign)
  })

  it('keeps objects still referenced by another draft of the owner (duplicates)', async () => {
    const shared = blob('shared.png')
    const original = await db.insertDraft(alice.id, { posts: [{ id: 'p', images: [shared] }] })
    await db.insertDraft(alice.id, { posts: [{ id: 'q', images: [shared] }] })
    await route(apiRequest(`/api/drafts/${original.id}`, { method: 'DELETE', cookie: aliceCookie }))
    const deleted = vi.mocked(deleteBlobUrls).mock.calls.flatMap(([urls]) => urls)
    expect(deleted).not.toContain(shared)
  })

  it('DELETE by a non-owner returns 404 and keeps the row; by the owner deletes its blob images', async () => {
    const draft = await db.insertDraft(alice.id, {
      posts: [{ id: 'p', text: '', images: [{ url: blob('a.png') }, blob('b.jpg')] }]
    })

    const denied = await route(apiRequest(`/api/drafts/${draft.id}`, { method: 'DELETE', cookie: bobCookie }))
    expect(denied.status).toBe(404)
    expect(deleteBlobUrls).not.toHaveBeenCalled()

    const ok = await route(apiRequest(`/api/drafts/${draft.id}`, { method: 'DELETE', cookie: aliceCookie }))
    expect(await json(ok)).toEqual({ ok: true })
    expect(deleteBlobUrls).toHaveBeenCalledWith([blob('a.png'), blob('b.jpg')])
    expect((await db.pg.query('select id from drafts where id = $1', [draft.id])).rows).toEqual([])
  })

  it('publish by a non-owner returns 404 and changes nothing', async () => {
    const draft = await db.insertDraft(alice.id, { posts: [{ id: 'p', images: [blob('a.png')] }] })
    const res = await route(apiRequest(`/api/drafts/${draft.id}/publish`, { method: 'POST', cookie: bobCookie }))
    expect(res.status).toBe(404)
    expect(deleteBlobUrls).not.toHaveBeenCalled()
    const { rows } = await db.pg.query('select is_published, posts from drafts where id = $1', [draft.id])
    expect(rows[0].is_published).toBe(false)
    expect(rows[0].posts[0].images).toEqual([blob('a.png')])
  })

  it('publish by the owner deletes the images, clears them from posts and marks the draft published', async () => {
    const draft = await db.insertDraft(alice.id, {
      posts: [
        { id: 'p1', text: 'one', images: [{ url: blob('a.png') }] },
        { id: 'p2', text: 'two', images: [blob('b.jpg')] }
      ]
    })
    const res = await route(apiRequest(`/api/drafts/${draft.id}/publish`, { method: 'POST', cookie: aliceCookie }))
    expect(res.status).toBe(200)

    expect(deleteBlobUrls).toHaveBeenCalledWith([blob('a.png'), blob('b.jpg')])
    const { draft: published } = await json(res)
    expect(published.is_published).toBe(true)
    expect(published.published_at).not.toBeNull()
    expect(published.posts.map((p) => p.images)).toEqual([[], []])
    expect(published.posts.map((p) => p.text)).toEqual(['one', 'two'])
  })
})

describe('share tokens', () => {
  it('owner gets a token; a non-owner gets 404', async () => {
    const draft = await db.insertDraft(alice.id)
    const denied = await route(apiRequest(`/api/drafts/${draft.id}/share-tokens`, { method: 'POST', cookie: bobCookie }))
    expect(denied.status).toBe(404)

    const ok = await route(apiRequest(`/api/drafts/${draft.id}/share-tokens`, { method: 'POST', cookie: aliceCookie }))
    expect(ok.status).toBe(201)
    // T2: the answer also carries the expiry and whether the link is one-time (the default).
    expect(await json(ok)).toEqual({ token: expect.stringMatching(/^[0-9a-f-]{36}$/), expires_at: expect.any(String), one_time: true })
  })
})

const fullPosts = (n = 25) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, text: 'x'.repeat(280), images: [], embeddedTweet: null }))
const bytes = (text) => new TextEncoder().encode(text).length

describe('GET /api/drafts?view=summary', () => {
  it('returns counts per draft and no post text', async () => {
    const draft = await db.insertDraft(alice.id, {
      title: 'Counted',
      posts: [
        { id: 'a', text: 'hello', images: [{ url: 'https://x.example/1.png' }], embeddedTweet: null },
        { id: 'b', text: 'y'.repeat(281), images: [], embeddedTweet: null }
      ]
    })
    const res = await route(apiRequest('/api/drafts?published=false&view=summary', { cookie: aliceCookie }))
    expect(res.status).toBe(200)
    const { drafts } = await json(res)
    expect(drafts).toEqual([
      {
        id: draft.id,
        title: 'Counted',
        is_published: false,
        updated_at: expect.any(String),
        published_at: null,
        version: 1,
        post_count: 2,
        total_chars: 5 + 281,
        over_limit_count: 1,
        image_count: 1
      }
    ])
    expect(drafts[0].posts).toBeUndefined()
  })

  it('answers 400 for an unknown view, and keeps the full drafts without it', async () => {
    expect((await route(apiRequest('/api/drafts?published=false&view=full', { cookie: aliceCookie }))).status).toBe(400)
    const full = await json(await route(apiRequest('/api/drafts?published=false', { cookie: aliceCookie })))
    expect(full.drafts).toEqual([])
  })

  it('counts emoji with the X rules: 141 emoji is 282, over the limit', async () => {
    await db.insertDraft(alice.id, { title: 'Emoji', posts: [{ id: 'e1', text: '😀'.repeat(141), images: [], embeddedTweet: null }] })
    const res = await route(apiRequest('/api/drafts?published=false&view=summary', { cookie: aliceCookie }))
    const draft = (await res.json()).drafts.find((d) => d.title === 'Emoji')
    expect(draft).toMatchObject({ total_chars: 282, over_limit_count: 1 })
  })

  it('answers under 600 bytes for a draft of 25 full posts', async () => {
    await db.insertDraft(alice.id, { title: 'Big', posts: fullPosts() })
    const res = await route(apiRequest('/api/drafts?published=false&view=summary', { cookie: aliceCookie }))
    const text = await res.text()
    expect(bytes(text)).toBeLessThan(600)
    expect(JSON.parse(text).drafts[0]).toMatchObject({ post_count: 25, total_chars: 25 * 280, over_limit_count: 0 })
  })
})

describe('GET /api/drafts/:id/outline', () => {
  it('gives each post its index, length, room left and a 40-character preview', async () => {
    const long = 'a'.repeat(300)
    const draft = await db.insertDraft(alice.id, {
      title: 'Outline',
      posts: [
        { id: 'first', text: 'Hello there, this is the first post of the thread.', images: [], embeddedTweet: null },
        { id: 'second', text: long, images: [{ url: 'https://x.example/2.png' }], embeddedTweet: null }
      ]
    })
    const res = await route(apiRequest(`/api/drafts/${draft.id}/outline`, { cookie: aliceCookie }))
    expect(res.status).toBe(200)
    const { draft: outline } = await json(res)
    expect(outline).toMatchObject({ id: draft.id, title: 'Outline', post_count: 2, over_limit_count: 1, image_count: 1 })
    expect(outline.posts).toEqual([
      {
        id: 'first',
        index: 1,
        chars: 50,
        remaining: 230,
        over_limit: false,
        image_count: 0,
        preview: 'Hello there, this is the first post of the thread'.slice(0, 40)
      },
      { id: 'second', index: 2, chars: 300, remaining: -20, over_limit: true, image_count: 1, preview: 'a'.repeat(40) }
    ])
  })

  it('is owner only: another user gets 404 and no session gets 401', async () => {
    const draft = await db.insertDraft(alice.id, { title: 'Private' })
    expect((await route(apiRequest(`/api/drafts/${draft.id}/outline`, { cookie: bobCookie }))).status).toBe(404)
    expect((await route(apiRequest(`/api/drafts/${draft.id}/outline`))).status).toBe(401)
  })
})
