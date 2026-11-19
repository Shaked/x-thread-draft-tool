// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({
  putBlob: vi.fn(async (pathname) => ({
    url: `https://store.public.blob.vercel-storage.com/${pathname.replace(/\.(\w+)$/, '-rand.$1')}`
  })),
  deleteBlobUrls: vi.fn(async () => {})
}))

import { deleteBlobUrls, putBlob } from '../../server/blob.js'
import { route } from '../../server/router.js'
import { usedImageUrls } from '../../server/routes/drafts.js'
import { query } from '../../server/db.js'
import { apiRequest, setupTestDb } from './helpers/db.js'

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

afterEach(() => {
  vi.clearAllMocks()
})

const upload = (cookie, { type = 'image/png', bytes = new Uint8Array([1, 2, 3]), draftId = draft.id } = {}) =>
  route(
    apiRequest(`/api/images?draftId=${draftId}`, {
      method: 'POST',
      cookie,
      headers: { 'content-type': type },
      body: bytes
    })
  )

describe('POST /api/images', () => {
  it('stores an image under the caller and draft prefix and returns its URL', async () => {
    const res = await upload(aliceCookie)
    expect(res.status).toBe(201)
    const { url } = await res.json()
    expect(url).toMatch(/^https:\/\/store\.public\.blob\.vercel-storage\.com\//)

    expect(putBlob).toHaveBeenCalledTimes(1)
    const [pathname, body, options] = vi.mocked(putBlob).mock.calls[0]
    expect(pathname).toMatch(new RegExp(`^drafts/${alice.id}/${draft.id}/[0-9a-f-]{36}\\.png$`))
    expect(body).toBeInstanceOf(Uint8Array)
    expect(options).toEqual({ contentType: 'image/png' })
  })

  it('rejects a non-image content type with 415', async () => {
    const res = await upload(aliceCookie, { type: 'text/plain' })
    expect(res.status).toBe(415)
    expect(putBlob).not.toHaveBeenCalled()
  })

  it('rejects an image over 4 MB with 413', async () => {
    const res = await upload(aliceCookie, { bytes: new Uint8Array(4 * 1024 * 1024 + 1) })
    expect(res.status).toBe(413)
    expect(putBlob).not.toHaveBeenCalled()
  })

  it('refuses to upload into a draft the caller does not own', async () => {
    const res = await upload(bobCookie)
    expect(res.status).toBe(404)
    expect(putBlob).not.toHaveBeenCalled()
  })

  it('requires a session', async () => {
    expect((await upload(undefined)).status).toBe(401)
  })
})

describe('DELETE /api/images', () => {
  it('deletes an image under the caller prefix', async () => {
    const url = `https://store.public.blob.vercel-storage.com/drafts/${alice.id}/${draft.id}/x.png`
    const res = await route(apiRequest('/api/images', { method: 'DELETE', cookie: aliceCookie, body: { url } }))
    expect(res.status).toBe(200)
    expect(deleteBlobUrls).toHaveBeenCalledWith([url])
  })

  it('refuses an image outside the caller prefix with 403', async () => {
    const url = `https://store.public.blob.vercel-storage.com/drafts/${bob.id}/${draft.id}/x.png`
    const res = await route(apiRequest('/api/images', { method: 'DELETE', cookie: aliceCookie, body: { url } }))
    expect(res.status).toBe(403)
    expect(deleteBlobUrls).not.toHaveBeenCalled()
  })

  it('refuses a URL on a host that is not Blob storage, even with a matching path', async () => {
    const url = `https://evil.example/drafts/${alice.id}/${draft.id}/x.png`
    const res = await route(apiRequest('/api/images', { method: 'DELETE', cookie: aliceCookie, body: { url } }))
    expect(res.status).toBe(403)
  })

  it('returns 400 for a malformed URL', async () => {
    const res = await route(apiRequest('/api/images', { method: 'DELETE', cookie: aliceCookie, body: { url: 'nope' } }))
    expect(res.status).toBe(400)
  })
})

// P8 (docs/plans/performance.md section 5 P8): a file is deleted only when no draft of its owner
// still uses its URL. "Uses" is decided in SQL (usedImageUrls), so it does not depend on the count of drafts.
describe('P8: a file another draft still uses is kept', () => {
  const blobUrl = (uid, draftId, name = 'x.png') => `https://store.public.blob.vercel-storage.com/drafts/${uid}/${draftId}/${name}`
  const deleteIfUnused = (cookie, url) => route(apiRequest('/api/images', { method: 'DELETE', cookie, body: { url, if_unused: true } }))
  const withImage = (url) => [{ id: 'p1', text: 'copy', images: [{ url }], embeddedTweet: null }]

  it('if_unused keeps a file that a duplicate draft still uses and answers deleted false', async () => {
    const url = blobUrl(alice.id, draft.id, 'shared.png')
    await db.insertDraft(alice.id, { title: 'Duplicate', posts: withImage(url) })
    const res = await deleteIfUnused(aliceCookie, url)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, deleted: false })
    expect(deleteBlobUrls).not.toHaveBeenCalled()
  })

  it('if_unused keeps a file whose URL is only plain text in another draft', async () => {
    const url = blobUrl(alice.id, draft.id, 'in-text.png')
    await db.insertDraft(alice.id, { title: 'Text only', posts: [{ id: 'p1', text: `see ${url}`, images: [], embeddedTweet: null }] })
    expect(await (await deleteIfUnused(aliceCookie, url)).json()).toEqual({ ok: true, deleted: false })
    expect(deleteBlobUrls).not.toHaveBeenCalled()
  })

  it('if_unused deletes a file no draft of the caller uses and answers deleted true', async () => {
    const url = blobUrl(alice.id, draft.id, 'unused.png')
    const res = await deleteIfUnused(aliceCookie, url)
    expect(await res.json()).toEqual({ ok: true, deleted: true })
    expect(deleteBlobUrls).toHaveBeenCalledWith([url])
  })

  it('without if_unused the answer is { ok: true } and the file is deleted even when a duplicate uses it (as before)', async () => {
    const url = blobUrl(alice.id, draft.id, 'plain.png')
    await db.insertDraft(alice.id, { title: 'Duplicate', posts: withImage(url) })
    const res = await route(apiRequest('/api/images', { method: 'DELETE', cookie: aliceCookie, body: { url } }))
    expect(await res.json()).toEqual({ ok: true })
    expect(deleteBlobUrls).toHaveBeenCalledWith([url])
  })

  it('if_unused false behaves like no field', async () => {
    const url = blobUrl(alice.id, draft.id, 'false.png')
    const res = await route(apiRequest('/api/images', { method: 'DELETE', cookie: aliceCookie, body: { url, if_unused: false } }))
    expect(await res.json()).toEqual({ ok: true })
    expect(deleteBlobUrls).toHaveBeenCalledWith([url])
  })

  it('a non-boolean if_unused is 400 and deletes nothing', async () => {
    const url = blobUrl(alice.id, draft.id, 'bad.png')
    const res = await route(apiRequest('/api/images', { method: 'DELETE', cookie: aliceCookie, body: { url, if_unused: 'yes' } }))
    expect(res.status).toBe(400)
    expect(deleteBlobUrls).not.toHaveBeenCalled()
  })

  it('another user\'s URL is refused with 403 with if_unused too, and nothing is read or deleted', async () => {
    const url = blobUrl(bob.id, draft.id, 'bobs.png')
    const res = await deleteIfUnused(aliceCookie, url)
    expect(res.status).toBe(403)
    expect(deleteBlobUrls).not.toHaveBeenCalled()
  })

  it('a user with 250 drafts (above the old 200 cap) still gets a correct answer', async () => {
    await db.pg.query("insert into drafts (user_id, title, posts) select $1, 'Filler ' || g, '[]'::jsonb from generate_series(1, 248) g", [alice.id])
    const used = blobUrl(alice.id, draft.id, 'deep-used.png')
    await db.insertDraft(alice.id, { title: 'Last duplicate', posts: withImage(used) })
    const { rows } = await db.pg.query('select count(*)::int as n from drafts where user_id = $1', [alice.id])
    expect(rows[0].n).toBe(250)

    expect(await (await deleteIfUnused(aliceCookie, used)).json()).toEqual({ ok: true, deleted: false })
    expect(deleteBlobUrls).not.toHaveBeenCalled()

    const unused = blobUrl(alice.id, draft.id, 'deep-unused.png')
    expect(await (await deleteIfUnused(aliceCookie, unused)).json()).toEqual({ ok: true, deleted: true })
    expect(deleteBlobUrls).toHaveBeenCalledWith([unused])
  })
})

describe('P8: draft delete and publish keep a file another draft still uses', () => {
  const url = () => `https://store.public.blob.vercel-storage.com/drafts/${alice.id}/${draft.id}/shared.png`
  // Every URL passed to deleteBlobUrls (DELETE /api/drafts/:id calls it with [] when nothing is deleted).
  const deletedUrls = () => vi.mocked(deleteBlobUrls).mock.calls.flatMap(([urls]) => urls)

  it('DELETE /api/drafts/:id keeps a file a duplicate still uses', async () => {
    const shared = url()
    const mine = await db.insertDraft(alice.id, { posts: [{ id: 'p1', text: 'a', images: [{ url: shared }], embeddedTweet: null }] })
    await db.insertDraft(alice.id, { title: 'Copy', posts: [{ id: 'p1', text: 'b', images: [{ url: shared }], embeddedTweet: null }] })
    const res = await route(apiRequest(`/api/drafts/${mine.id}`, { method: 'DELETE', cookie: aliceCookie }))
    expect(res.status).toBe(200)
    expect(deletedUrls()).not.toContain(shared)
  })

  it('DELETE /api/drafts/:id deletes a file no other draft uses', async () => {
    const shared = url()
    const mine = await db.insertDraft(alice.id, { posts: [{ id: 'p1', text: 'a', images: [{ url: shared }], embeddedTweet: null }] })
    const res = await route(apiRequest(`/api/drafts/${mine.id}`, { method: 'DELETE', cookie: aliceCookie }))
    expect(res.status).toBe(200)
    expect(deletedUrls()).toEqual([shared])
  })

  it('publish keeps a file a duplicate still uses', async () => {
    const shared = url()
    const mine = await db.insertDraft(alice.id, { posts: [{ id: 'p1', text: 'a', images: [{ url: shared }], embeddedTweet: null }] })
    await db.insertDraft(alice.id, { title: 'Copy', posts: [{ id: 'p1', text: 'b', images: [{ url: shared }], embeddedTweet: null }] })
    const res = await route(apiRequest(`/api/drafts/${mine.id}/publish`, { method: 'POST', cookie: aliceCookie }))
    expect(res.status).toBe(200)
    expect(deletedUrls()).not.toContain(shared)
  })

  it('publish deletes a file no other draft uses', async () => {
    const shared = url()
    const mine = await db.insertDraft(alice.id, { posts: [{ id: 'p1', text: 'a', images: [{ url: shared }], embeddedTweet: null }] })
    const res = await route(apiRequest(`/api/drafts/${mine.id}/publish`, { method: 'POST', cookie: aliceCookie }))
    expect(res.status).toBe(200)
    expect(deletedUrls()).toEqual([shared])
  })
})

describe('P8: a URL with JSON-escaped characters is still seen as used', () => {
  // jsonb text escapes these (tab as \t, quote as \", backslash as \\); the URL itself does not.
  const urls = () => {
    const base = `https://store.public.blob.vercel-storage.com/drafts/${alice.id}/${draft.id}/`
    return [`${base}tab\there.png`, `${base}quo"te.png`, `${base}back\\slash.png`]
  }

  it('usedImageUrls reports tab, quote and backslash URLs as used', async () => {
    const list = urls()
    await db.insertDraft(alice.id, { title: 'Escaped', posts: [{ id: 'p1', text: 'x', images: list.map((url) => ({ url })), embeddedTweet: null }] })
    const used = await usedImageUrls(query, alice.id, list, null)
    expect([...used].sort()).toEqual([...list].sort())
  })

  it('DELETE /api/images with if_unused keeps each of them and answers deleted false', async () => {
    const list = urls()
    await db.insertDraft(alice.id, { title: 'Escaped', posts: [{ id: 'p1', text: 'x', images: list.map((url) => ({ url })), embeddedTweet: null }] })
    for (const url of list) {
      const res = await deleteIfUnusedFor(aliceCookie, url)
      expect(await res.json()).toEqual({ ok: true, deleted: false })
    }
    expect(deleteBlobUrls).not.toHaveBeenCalled()
  })
})

function deleteIfUnusedFor(cookie, url) {
  return route(apiRequest('/api/images', { method: 'DELETE', cookie, body: { url, if_unused: true } }))
}
