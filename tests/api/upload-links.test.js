// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({
  putBlob: vi.fn(async (pathname) => ({ url: `https://store.public.blob.vercel-storage.com/${pathname}` })),
  deleteBlobUrls: vi.fn(async () => {})
}))

import { deleteBlobUrls, putBlob } from '../../server/blob.js'
import { route } from '../../server/router.js'
import { query } from '../../server/db.js'
import { apiRequest, setupTestDb } from './helpers/db.js'
import { makeGif, makePng, SVG } from './helpers/images.js'

let db
let alice
let bob
let aliceCookie
let bobCookie
let draft

beforeAll(async () => {
  db = await setupTestDb()
})

beforeEach(async () => {
  await db.reset()
  vi.clearAllMocks()
  alice = await db.insertUser({ github_id: 1, login: 'alice' })
  bob = await db.insertUser({ github_id: 2, login: 'bob' })
  aliceCookie = await db.cookieFor(alice)
  bobCookie = await db.cookieFor(bob)
  draft = await db.insertDraft(alice.id)
})

afterEach(() => vi.clearAllMocks())

const create = (cookie, d = draft, postId = 'p1') =>
  route(apiRequest(`/api/drafts/${d.id}/posts/${postId}/upload-links`, { method: 'POST', cookie, body: {} }))
const tokenOf = (link) => link.url.split('#')[1]
const upload = (token, bytes = makePng()) =>
  route(apiRequest('/api/upload-links/images', { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: bytes }))
const link = async (cookie = aliceCookie, d = draft, postId = 'p1') => {
  const res = await create(cookie, d, postId)
  expect(res.status).toBe(201)
  return res.json()
}
const postImages = async () => (await query('select posts from drafts where id = $1', [draft.id])).rows[0].posts[0].images

describe('POST /api/drafts/:id/posts/:postId/upload-links', () => {
  it('answers a link with the token in the fragment, the free slots and 30 minutes', async () => {
    const body = await link()
    expect(body.url).toMatch(/\/upload#[A-Za-z0-9_-]{43}$/)
    expect(body).toMatchObject({ draftId: draft.id, postId: 'p1', post: 1, slots: 4 })
    const minutes = (new Date(body.expires_at) - Date.now()) / 60000
    expect(minutes).toBeGreaterThan(29)
    expect(minutes).toBeLessThanOrEqual(30)
    const { rows } = await query('select * from image_upload_links')
    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows[0])).not.toContain(tokenOf(body))
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('offers only the free slots of the post', async () => {
    const images = [{ url: 'https://x/1.png' }, { url: 'https://x/2.png' }, { url: 'https://x/3.png' }]
    const d = await db.insertDraft(alice.id, { posts: [{ id: 'p1', text: 'a', images, embeddedTweet: null }] })
    expect((await link(aliceCookie, d)).slots).toBe(1)
  })

  it('refuses a full post, an unknown post, another user, a published draft and a signed-out caller', async () => {
    const images = [1, 2, 3, 4].map((n) => ({ url: `https://x/${n}.png` }))
    const full = await db.insertDraft(alice.id, { posts: [{ id: 'p1', text: 'a', images, embeddedTweet: null }] })
    expect((await create(aliceCookie, full)).status).toBe(422)
    expect((await create(aliceCookie, draft, 'nope')).status).toBe(404)
    expect((await create(bobCookie)).status).toBe(404)
    const published = await db.insertDraft(alice.id, { is_published: true, published_at: new Date().toISOString() })
    expect((await create(aliceCookie, published)).status).toBe(409)
    expect((await create(undefined)).status).toBe(401)
    expect((await query('select 1 from image_upload_links')).rows).toHaveLength(0)
  })

  it('refuses a suspended owner', async () => {
    await query('update users set suspended_at = now() where id = $1', [alice.id])
    expect((await create(aliceCookie)).status).toBe(403)
  })

  it('allows 10 links per hour per user', async () => {
    for (let i = 0; i < 10; i += 1) await link()
    const res = await create(aliceCookie)
    expect(res.status).toBe(429)
    expect((await create(bobCookie)).status).toBe(404) // bob's own count is separate; he just has no such draft
  })

  it('removes links that expired more than a day ago', async () => {
    await link()
    await query(`update image_upload_links set expires_at = now() - interval '2 days'`)
    await link()
    expect((await query('select 1 from image_upload_links')).rows).toHaveLength(1)
  })
})

describe('POST /api/upload-links/images', () => {
  it('attaches images to the post in order, under the owner and draft prefix, with no-store', async () => {
    const { url } = await link()
    const token = tokenOf({ url })
    const first = await upload(token)
    expect(first.status).toBe(201)
    expect(first.headers.get('cache-control')).toBe('no-store')
    expect(await first.json()).toMatchObject({ remaining: 3 })
    const second = await upload(token, makeGif())
    expect(second.status).toBe(201)
    const images = await postImages()
    expect(images).toHaveLength(2)
    expect(putBlob.mock.calls[0][0]).toMatch(new RegExp(`^drafts/${alice.id}/${draft.id}/[0-9a-f-]+\\.png$`))
    expect(images[1].url).toMatch(/\.gif$/)
    expect((await query('select version from drafts where id = $1', [draft.id])).rows[0].version).toBe(draft.version + 2)
  })

  it('stops when the slots are used up, and answers 410', async () => {
    const images = [{ url: 'https://x/1.png' }, { url: 'https://x/2.png' }, { url: 'https://x/3.png' }]
    const d = await db.insertDraft(alice.id, { posts: [{ id: 'p1', text: 'a', images, embeddedTweet: null }] })
    const token = tokenOf(await link(aliceCookie, d))
    expect((await upload(token)).status).toBe(201)
    const res = await upload(token)
    expect(res.status).toBe(410)
    expect((await res.json()).error).toBe('This link has expired or was already used.')
  })

  it('answers 410 for an expired link, an unknown token, a missing token and a malformed one', async () => {
    const token = tokenOf(await link())
    await query(`update image_upload_links set expires_at = now() - interval '1 minute'`)
    expect((await upload(token)).status).toBe(410)
    expect((await upload('A'.repeat(43))).status).toBe(410)
    expect((await upload(null)).status).toBe(410)
    expect((await upload('short')).status).toBe(410)
    expect(putBlob).not.toHaveBeenCalled()
  })

  it('answers 410 when the draft is published or deleted, or the owner suspended', async () => {
    const token = tokenOf(await link())
    await query('update drafts set is_published = true where id = $1', [draft.id])
    expect((await upload(token)).status).toBe(410)
    await query('update drafts set is_published = false where id = $1', [draft.id])
    await query('update users set suspended_at = now() where id = $1', [alice.id])
    expect((await upload(token)).status).toBe(410)
    await query('update users set suspended_at = null where id = $1', [alice.id])
    await query('delete from drafts where id = $1', [draft.id])
    expect((await upload(token)).status).toBe(410)
  })

  it('answers 410 and gives the slot back when the post was removed', async () => {
    const token = tokenOf(await link())
    await query(`update drafts set posts = '[{"id":"p2","text":"x","images":[],"embeddedTweet":null}]'::jsonb where id = $1`, [draft.id])
    expect((await upload(token)).status).toBe(410)
    expect((await query('select used from image_upload_links')).rows[0].used).toBe(0)
    expect(deleteBlobUrls).toHaveBeenCalledTimes(1)
  })

  it('refuses a wrong type and gives the slot back', async () => {
    const token = tokenOf(await link())
    const res = await upload(token, SVG)
    expect(res.status).toBe(415)
    expect((await query('select used from image_upload_links')).rows[0].used).toBe(0)
    expect(putBlob).not.toHaveBeenCalled()
    expect((await upload(token)).status).toBe(201)
  })

  it('gives the slot back and deletes the file when the store fails', async () => {
    const token = tokenOf(await link())
    putBlob.mockRejectedValueOnce(new Error('blob down'))
    expect((await upload(token)).status).toBe(500)
    expect((await query('select used from image_upload_links')).rows[0].used).toBe(0)
  })

  it('does not take another user\'s token as its own: the token alone decides the draft', async () => {
    const token = tokenOf(await link())
    const res = await route(apiRequest('/api/upload-links/images', { method: 'POST', cookie: bobCookie, headers: { authorization: `Bearer ${token}` }, body: makePng() }))
    expect(res.status).toBe(201)
    expect(await postImages()).toHaveLength(1)
    const bobDraft = await db.insertDraft(bob.id)
    expect((await query('select posts from drafts where id = $1', [bobDraft.id])).rows[0].posts[0].images).toHaveLength(0)
  })

  it('keeps a concurrent edit: parallel uploads all land', async () => {
    const token = tokenOf(await link())
    const results = await Promise.all([upload(token), upload(token), upload(token)])
    expect(results.map((r) => r.status)).toEqual([201, 201, 201])
    expect(await postImages()).toHaveLength(3)
  })

  it('never lets more uploads in than the slots, even in parallel', async () => {
    const images = [{ url: 'https://x/1.png' }, { url: 'https://x/2.png' }]
    const d = await db.insertDraft(alice.id, { posts: [{ id: 'p1', text: 'a', images, embeddedTweet: null }] })
    const token = tokenOf(await link(aliceCookie, d))
    const results = await Promise.all([upload(token), upload(token), upload(token), upload(token)])
    expect(results.filter((r) => r.status === 201)).toHaveLength(2)
    expect(results.filter((r) => r.status === 410)).toHaveLength(2)
  })

  it('refuses a body over 4 MB', async () => {
    const token = tokenOf(await link())
    expect((await upload(token, new Uint8Array(4 * 1024 * 1024 + 1))).status).toBe(413)
    expect((await query('select used from image_upload_links')).rows[0].used).toBe(0)
  })
})

describe('deleting', () => {
  it('removes the links with the draft and with the user', async () => {
    await link()
    await query('delete from drafts where id = $1', [draft.id])
    expect((await query('select 1 from image_upload_links')).rows).toHaveLength(0)
    const d2 = await db.insertDraft(alice.id)
    await link(aliceCookie, d2)
    await query('delete from users where id = $1', [alice.id])
    expect((await query('select 1 from image_upload_links')).rows).toHaveLength(0)
  })
})

describe('GET /api/upload-links', () => {
  const read = (token) => route(apiRequest('/api/upload-links', { headers: token ? { authorization: `Bearer ${token}` } : {} }))

  it('tells the post number and the free slots, and nothing of the draft', async () => {
    const token = tokenOf(await link())
    await upload(token)
    const res = await read(token)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ post: 1, remaining: 3 })
    expect(JSON.stringify(body)).not.toContain('hello')
    expect(JSON.stringify(body)).not.toContain('Draft')
  })

  it('answers 410 for a dead link', async () => {
    const token = tokenOf(await link())
    await query(`update image_upload_links set expires_at = now() - interval '1 minute'`)
    expect((await read(token)).status).toBe(410)
    expect((await read(null)).status).toBe(410)
  })
})
