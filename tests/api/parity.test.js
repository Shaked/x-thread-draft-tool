// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({ putBlob: vi.fn(), deleteBlobUrls: vi.fn(async () => {}) }))

import { route } from '../../server/router.js'
import { apiRequest, setupTestDb } from './helpers/db.js'

let db
let alice
let bob
let aliceCookie

beforeAll(async () => {
  db = await setupTestDb()
})

beforeEach(async () => {
  await db.reset()
  alice = await db.insertUser({ github_id: 1, login: 'alice' })
  bob = await db.insertUser({ github_id: 2, login: 'bob' })
  aliceCookie = await db.cookieFor(alice)
})

describe('POST /api/drafts/:id/duplicate', () => {
  it('copies the draft with new post ids and a "(copy)" title', async () => {
    const draft = await db.insertDraft(alice.id, {
      title: 'Launch',
      posts: [{ id: 'old-1', text: 'one', images: [], embeddedTweet: null }]
    })
    const res = await route(apiRequest(`/api/drafts/${draft.id}/duplicate`, { method: 'POST', cookie: aliceCookie }))
    expect(res.status).toBe(201)
    const { draft: copy } = await res.json()
    expect(copy.id).not.toBe(draft.id)
    expect(copy.title).toBe('Launch (copy)')
    expect(copy.posts[0]).toMatchObject({ text: 'one' })
    expect(copy.posts[0].id).not.toBe('old-1')
  })

  it('refuses to duplicate someone else draft', async () => {
    const draft = await db.insertDraft(bob.id)
    const res = await route(apiRequest(`/api/drafts/${draft.id}/duplicate`, { method: 'POST', cookie: aliceCookie }))
    expect(res.status).toBe(404)
  })
})

describe('GET /api/drafts/:id/export', () => {
  it('exports json, text and formatted text for the owner', async () => {
    const draft = await db.insertDraft(alice.id, {
      title: 'T',
      posts: [
        { id: 'a', text: 'First', images: [] },
        { id: 'b', text: 'Second', images: [] }
      ]
    })
    const json = await route(apiRequest(`/api/drafts/${draft.id}/export?format=json`, { cookie: aliceCookie }))
    expect(json.headers.get('content-type')).toContain('application/json')
    expect((await json.json()).posts).toHaveLength(2)

    const text = await route(apiRequest(`/api/drafts/${draft.id}/export?format=text`, { cookie: aliceCookie }))
    expect(text.headers.get('content-type')).toContain('text/plain')
    expect(await text.text()).toBe('First\n\nSecond')

    const formatted = await route(apiRequest(`/api/drafts/${draft.id}/export?format=formatted`, { cookie: aliceCookie }))
    expect(await formatted.text()).toContain('Tweet 1/2 (5 chars):')
  })

  it('refuses export to another user (404) and to a signed-out visitor (401)', async () => {
    const draft = await db.insertDraft(alice.id)
    const other = await route(apiRequest(`/api/drafts/${draft.id}/export?format=text`, { cookie: await db.cookieFor(bob) }))
    expect(other.status).toBe(404)
    const anonymous = await route(apiRequest(`/api/drafts/${draft.id}/export?format=text`))
    expect(anonymous.status).toBe(401)
  })

  it('rejects an unknown format with 400', async () => {
    const draft = await db.insertDraft(alice.id)
    const res = await route(apiRequest(`/api/drafts/${draft.id}/export?format=pdf`, { cookie: aliceCookie }))
    expect(res.status).toBe(400)
  })
})

describe('POST /api/threads/split', () => {
  it('splits long text into posts of at most max_chars', async () => {
    const text = 'word '.repeat(200).trim()
    const res = await route(apiRequest('/api/threads/split', { method: 'POST', body: { text, max_chars: 100 } }))
    expect(res.status).toBe(200)
    const { posts } = await res.json()
    expect(posts.length).toBeGreaterThan(1)
    for (const post of posts) expect(post.chars).toBeLessThanOrEqual(100)
  })

  it('validates text and max_chars', async () => {
    const noText = await route(apiRequest('/api/threads/split', { method: 'POST', body: { text: 5 } }))
    expect(noText.status).toBe(400)
    const badMax = await route(apiRequest('/api/threads/split', { method: 'POST', body: { text: 'x', max_chars: 5 } }))
    expect(badMax.status).toBe(400)
  })
})

describe('GET /api/drafts?limit=', () => {
  it('caps the page size and validates the limit', async () => {
    await db.insertDraft(alice.id, { title: 'one' })
    await db.insertDraft(alice.id, { title: 'two' })
    await db.insertDraft(alice.id, { title: 'three' })
    const two = await route(apiRequest('/api/drafts?published=false&limit=2', { cookie: aliceCookie }))
    expect((await two.json()).drafts).toHaveLength(2)
    const zero = await route(apiRequest('/api/drafts?published=false&limit=0', { cookie: aliceCookie }))
    expect(zero.status).toBe(400)
    const big = await route(apiRequest('/api/drafts?published=false&limit=201', { cookie: aliceCookie }))
    expect(big.status).toBe(400)
  })
})
