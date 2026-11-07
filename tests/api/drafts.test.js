// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({
  putBlob: vi.fn(),
  deleteBlobUrls: vi.fn(async () => {})
}))

import { deleteBlobUrls } from '../../server/blob.js'
import { route } from '../../server/router.js'
import { apiRequest, setupTestDb } from './helpers/db.js'

const BLOB_A = 'https://store.public.blob.vercel-storage.com/drafts/u/d/a.png'
const BLOB_B = 'https://store.public.blob.vercel-storage.com/drafts/u/d/b.jpg'

let db
let alice
let bob
let aliceCookie
let bobCookie

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
  it('is public: anyone with the id can read the draft', async () => {
    const draft = await db.insertDraft(alice.id, { title: 'shared' })
    const res = await route(apiRequest(`/api/drafts/${draft.id}`))
    expect(res.status).toBe(200)
    expect((await json(res)).draft).toMatchObject({ id: draft.id, title: 'shared', user_id: alice.id })
  })

  it('returns 404 for an invalid UUID and for a missing draft', async () => {
    expect((await route(apiRequest('/api/drafts/not-a-uuid'))).status).toBe(404)
    const missing = '00000000-0000-4000-8000-000000000000'
    expect((await route(apiRequest(`/api/drafts/${missing}`))).status).toBe(404)
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

  it('DELETE by a non-owner returns 404 and keeps the row; by the owner deletes its blob images', async () => {
    const draft = await db.insertDraft(alice.id, {
      posts: [{ id: 'p', text: '', images: [{ url: BLOB_A }, BLOB_B] }]
    })

    const denied = await route(apiRequest(`/api/drafts/${draft.id}`, { method: 'DELETE', cookie: bobCookie }))
    expect(denied.status).toBe(404)
    expect(deleteBlobUrls).not.toHaveBeenCalled()

    const ok = await route(apiRequest(`/api/drafts/${draft.id}`, { method: 'DELETE', cookie: aliceCookie }))
    expect(await json(ok)).toEqual({ ok: true })
    expect(deleteBlobUrls).toHaveBeenCalledWith([BLOB_A, BLOB_B])
    expect((await db.pg.query('select id from drafts where id = $1', [draft.id])).rows).toEqual([])
  })

  it('publish by a non-owner returns 404 and changes nothing', async () => {
    const draft = await db.insertDraft(alice.id, { posts: [{ id: 'p', images: [BLOB_A] }] })
    const res = await route(apiRequest(`/api/drafts/${draft.id}/publish`, { method: 'POST', cookie: bobCookie }))
    expect(res.status).toBe(404)
    expect(deleteBlobUrls).not.toHaveBeenCalled()
    const { rows } = await db.pg.query('select is_published, posts from drafts where id = $1', [draft.id])
    expect(rows[0].is_published).toBe(false)
    expect(rows[0].posts[0].images).toEqual([BLOB_A])
  })

  it('publish by the owner deletes the images, clears them from posts and marks the draft published', async () => {
    const draft = await db.insertDraft(alice.id, {
      posts: [
        { id: 'p1', text: 'one', images: [{ url: BLOB_A }] },
        { id: 'p2', text: 'two', images: [BLOB_B] }
      ]
    })
    const res = await route(apiRequest(`/api/drafts/${draft.id}/publish`, { method: 'POST', cookie: aliceCookie }))
    expect(res.status).toBe(200)

    expect(deleteBlobUrls).toHaveBeenCalledWith([BLOB_A, BLOB_B])
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
    expect(await json(ok)).toEqual({ token: expect.stringMatching(/^[0-9a-f-]{36}$/) })
  })
})
