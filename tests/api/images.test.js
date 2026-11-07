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
