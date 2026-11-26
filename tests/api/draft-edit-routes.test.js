// @vitest-environment node
// #412: one REST route per post and image edit. Owner only, 412 on a stale version, 409 on a published draft,
// the 4-images limit, the old file deleted when unused, the new file deleted on failure. Real route(), real SQL (PGlite).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({
  putBlob: vi.fn(async (pathname) => ({ url: `https://store.public.blob.vercel-storage.com/${pathname}` })),
  deleteBlobUrls: vi.fn(async () => {})
}))

import { deleteBlobUrls, putBlob } from '../../server/blob.js'
import { route } from '../../server/router.js'
import { setResolverForTests } from '../../server/remote-image.js'
import { apiRequest, setupTestDb } from './helpers/db.js'

const HOST = 'https://store.public.blob.vercel-storage.com'
let db
let alice
let bob
let cookie
let bobCookie
let draft
const img = (name) => ({ url: `${HOST}/drafts/${alice?.id}/x/${name}.png` })

beforeAll(async () => {
  db = await setupTestDb()
})

beforeEach(async () => {
  await db.reset()
  vi.clearAllMocks()
  alice = await db.insertUser({ github_id: 1, login: 'alice' })
  bob = await db.insertUser({ github_id: 2, login: 'bob' })
  cookie = await db.cookieFor(alice)
  bobCookie = await db.cookieFor(bob)
  setResolverForTests(async () => [{ address: '93.184.216.34', family: 4 }])
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } })))
  draft = await db.insertDraft(alice.id, {
    posts: [
      { id: 'a', text: 'first', images: [img('1'), img('2')], embeddedTweet: null },
      { id: 'b', text: 'second', images: [], embeddedTweet: null },
      { id: 'c', text: 'third', images: [], embeddedTweet: null }
    ]
  })
  return () => {
    setResolverForTests(null)
    vi.unstubAllGlobals()
  }
})

const send = (method, path, body, { who = cookie, ifMatch } = {}) =>
  route(apiRequest(`/api/drafts/${draft.id}${path}`, { method, body, cookie: who, headers: ifMatch === undefined ? {} : { 'if-match': ifMatch } }))
const stored = async () => (await db.pg.query('select posts, version, is_published from drafts where id = $1', [draft.id])).rows[0]
const ids = (row) => row.posts.map((post) => post.id)
const urls = (post) => post.images.map((image) => image.url)

describe('POST /drafts/:id/posts', () => {
  it('adds last, or after a post, and a replay of the same post_id and text writes nothing', async () => {
    expect((await send('POST', '/posts', { text: 'last' })).status).toBe(200)
    expect((await send('POST', '/posts', { text: 'mid', after_post_id: 'a', post_id: 'mine' })).status).toBe(200)
    expect(ids(await stored())).toEqual(['a', 'mine', 'b', 'c', expect.any(String)])
    const again = await send('POST', '/posts', { text: 'mid', post_id: 'mine' })
    expect(again.status).toBe(200)
    expect((await stored()).version).toBe(3)
    expect((await send('POST', '/posts', { text: 'other', post_id: 'mine' })).status).toBe(409)
  })

  it('refuses an unknown after_post_id (422), bad text (400), and a stale version (412)', async () => {
    expect((await send('POST', '/posts', { text: 'x', after_post_id: 'zzz' })).status).toBe(422)
    expect((await send('POST', '/posts', { text: 'x'.repeat(281) })).status).toBe(400)
    const stale = await send('POST', '/posts', { text: 'x' }, { ifMatch: '"7"' })
    expect(stale.status).toBe(412)
    expect((await stale.json()).version).toBe(1)
    expect((await stored()).version).toBe(1)
  })
})

describe('DELETE /drafts/:id/posts/:postId', () => {
  it('removes a post and deletes only the images no draft still uses', async () => {
    const other = await db.insertDraft(alice.id, { posts: [{ id: 'z', text: 'z', images: [img('2')], embeddedTweet: null }] })
    expect(other.id).not.toBe(draft.id)
    expect((await send('DELETE', '/posts/a')).status).toBe(200)
    expect(ids(await stored())).toEqual(['b', 'c'])
    expect(deleteBlobUrls).toHaveBeenCalledWith([img('1').url])
  })

  it('keeps one post, refuses an unknown post (422)', async () => {
    expect((await send('DELETE', '/posts/zzz')).status).toBe(422)
    await send('DELETE', '/posts/a')
    await send('DELETE', '/posts/b')
    const last = await send('DELETE', '/posts/c')
    expect(last.status).toBe(422)
    expect((await last.json()).error).toBe('A draft keeps at least one post.')
  })
})

describe('POST /drafts/:id/posts/:postId/move', () => {
  it('moves a post to a position, and checks the range', async () => {
    expect((await send('POST', '/posts/c/move', { position: 1 })).status).toBe(200)
    expect(ids(await stored())).toEqual(['c', 'a', 'b'])
    expect((await send('POST', '/posts/c/move', { position: 4 })).status).toBe(422)
    expect((await send('POST', '/posts/c/move', { position: 0 })).status).toBe(400)
  })

  it('with image_url moves the image to the post, and refuses a full post', async () => {
    expect((await send('POST', '/posts/b/move', { position: 1, image_url: img('2').url })).status).toBe(200)
    const row = await stored()
    expect(urls(row.posts[0])).toEqual([img('1').url])
    expect(urls(row.posts[1])).toEqual([img('2').url])
    const full = await db.insertDraft(alice.id, { posts: [{ id: 'f', text: 'f', images: [img('3'), img('4'), img('5'), img('6')], embeddedTweet: null }, { id: 'g', text: 'g', images: [img('7')], embeddedTweet: null }] })
    const res = await route(apiRequest(`/api/drafts/${full.id}/posts/f/move`, { method: 'POST', body: { position: 1, image_url: img('7').url }, cookie }))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/already has 4 images/)
  })

  it('a stale version is 412 and writes nothing', async () => {
    expect((await send('POST', '/posts/c/move', { position: 1 }, { ifMatch: '"9"' })).status).toBe(412)
    expect(ids(await stored())).toEqual(['a', 'b', 'c'])
  })
})

describe('POST /drafts/:id/images', () => {
  it('adds an image to a post at a place', async () => {
    const res = await send('POST', '/images', { url: 'https://example.com/n.png', post_id: 'a', position: 1 })
    expect(res.status).toBe(200)
    const { url } = await res.json()
    expect(urls((await stored()).posts[0])).toEqual([url, img('1').url, img('2').url])
  })

  it('refuses the fifth image before fetching, and deletes nothing', async () => {
    for (let n = 0; n < 2; n += 1) await send('POST', '/images', { url: 'https://example.com/n.png', post_id: 'a' })
    putBlob.mockClear()
    const res = await send('POST', '/images', { url: 'https://example.com/n.png', post_id: 'a' })
    expect(res.status).toBe(422)
    expect(putBlob).not.toHaveBeenCalled()
  })

  it('replace swaps the image in every post and deletes the old file when unused', async () => {
    const res = await send('POST', '/images', { url: 'https://example.com/n.png', replace: img('1').url })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(urls((await stored()).posts[0])).toEqual([body.url, img('2').url])
    expect(body.replaced).toBe(img('1').url)
    expect(deleteBlobUrls).toHaveBeenCalledWith([img('1').url])
  })

  it('deletes the new file when the write fails (stale version), and keeps the old one', async () => {
    const res = await send('POST', '/images', { url: 'https://example.com/n.png', replace: img('1').url }, { ifMatch: '"9"' })
    expect(res.status).toBe(412)
    const created = (await putBlob.mock.results[0].value).url
    expect(deleteBlobUrls).toHaveBeenCalledWith([created])
    expect(urls((await stored()).posts[0])).toEqual([img('1').url, img('2').url])
  })

  it('answers 404 for an unknown image or post and 400 without exactly one of post_id and replace', async () => {
    expect((await send('POST', '/images', { url: 'https://example.com/n.png', replace: 'nope' })).status).toBe(404)
    expect((await send('POST', '/images', { url: 'https://example.com/n.png', post_id: 'zzz' })).status).toBe(404)
    expect((await send('POST', '/images', { url: 'https://example.com/n.png' })).status).toBe(400)
  })
})

describe('DELETE /drafts/:id/images', () => {
  it('removes one url, or every image of a post, and says how many files were deleted', async () => {
    const one = await send('DELETE', '/images', { url: img('1').url })
    expect(one.status).toBe(200)
    expect(await one.json()).toMatchObject({ removed: 1, deleted: 1 })
    const all = await send('DELETE', '/images', { post_id: 'a' })
    expect(await all.json()).toMatchObject({ removed: 1, deleted: 1 })
    expect(urls((await stored()).posts[0])).toEqual([])
  })

  it('needs exactly one of url and post_id (422)', async () => {
    expect((await send('DELETE', '/images', {})).status).toBe(422)
    expect((await send('DELETE', '/images', { url: 'x', post_id: 'a' })).status).toBe(422)
  })
})

describe('every edit route', () => {
  const calls = [
    ['POST', '/posts', { text: 'x' }],
    ['DELETE', '/posts/a'],
    ['POST', '/posts/a/move', { position: 1 }],
    ['POST', '/images', { url: 'https://example.com/n.png', post_id: 'a' }],
    ['DELETE', '/images', { post_id: 'a' }]
  ]

  it.each(calls)('%s %s: another user gets 404, a published draft 409, and nothing is written', async (method, path, body) => {
    const before = await stored()
    expect((await send(method, path, body, { who: bobCookie })).status).toBe(404)
    expect(await stored()).toEqual(before)
    await db.pg.query('update drafts set is_published = true where id = $1', [draft.id])
    expect((await send(method, path, body)).status).toBe(409)
    expect(putBlob).not.toHaveBeenCalled()
    expect(ids(await stored())).toEqual(['a', 'b', 'c'])
  })
})
