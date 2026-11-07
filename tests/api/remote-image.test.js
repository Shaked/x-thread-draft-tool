// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({
  putBlob: vi.fn(async (pathname) => ({ url: `https://store.public.blob.vercel-storage.com/${pathname}` })),
  deleteBlobUrls: vi.fn(async () => {})
}))

import { putBlob } from '../../server/blob.js'
import { route } from '../../server/router.js'
import { isPrivateAddress, setResolverForTests } from '../../server/remote-image.js'
import { apiRequest, setupTestDb } from './helpers/db.js'

let db
let alice
let aliceCookie
let draft

const PUBLIC_IP = '93.184.216.34'

beforeAll(async () => {
  db = await setupTestDb()
})

beforeEach(async () => {
  await db.reset()
  vi.clearAllMocks()
  alice = await db.insertUser({ github_id: 1, login: 'alice' })
  aliceCookie = await db.cookieFor(alice)
  draft = await db.insertDraft(alice.id)
  // Public names resolve to a public address; "rebind.test" points at a private one.
  setResolverForTests(async (host) => {
    if (host === 'rebind.test') return [{ address: '10.1.2.3', family: 4 }]
    return [{ address: PUBLIC_IP, family: 4 }]
  })
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  setResolverForTests(null)
  vi.unstubAllGlobals()
})

const fromUrl = (url, cookie = aliceCookie) =>
  route(apiRequest('/api/images/from-url', { method: 'POST', cookie, body: { draftId: draft.id, url } }))

function imageResponse(bytes, type = 'image/png', extra = {}) {
  return new Response(bytes, { status: 200, headers: { 'content-type': type, ...extra } })
}

describe('isPrivateAddress', () => {
  it.each([
    ['127.0.0.1'],
    ['10.0.0.1'],
    ['172.16.5.5'],
    ['192.168.1.1'],
    ['169.254.169.254'],
    ['100.64.0.1'],
    ['0.0.0.0'],
    ['224.0.0.1'],
    ['::1'],
    ['::'],
    ['fc00::1'],
    ['fe80::1'],
    ['::ffff:10.0.0.1']
  ])('treats %s as private', (address) => {
    expect(isPrivateAddress(address)).toBe(true)
  })

  it.each([['93.184.216.34'], ['8.8.8.8'], ['2606:4700:4700::1111']])('treats %s as public', (address) => {
    expect(isPrivateAddress(address)).toBe(false)
  })
})

describe('POST /api/images/from-url', () => {
  it.each([
    ['http://127.0.0.1/a.png'],
    ['http://10.0.0.1/a.png'],
    ['http://[::1]/a.png'],
    ['http://169.254.169.254/latest/meta-data'],
    ['http://rebind.test/a.png'],
    ['ftp://example.com/a.png'],
    ['https://user:pass@example.com/a.png']
  ])('refuses %s before any request is made', async (url) => {
    const res = await fromUrl(url)
    expect(res.status).toBe(400)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('refuses redirects', async () => {
    globalThis.fetch.mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://10.0.0.1/x' } }))
    const res = await fromUrl('https://example.com/a.png')
    expect(res.status).toBe(400)
  })

  it('refuses a response that is not an image', async () => {
    globalThis.fetch.mockResolvedValue(new Response('<html></html>', { headers: { 'content-type': 'text/html' } }))
    const res = await fromUrl('https://example.com/page')
    expect(res.status).toBe(415)
  })

  it('refuses an image over 4 MB', async () => {
    const big = new Uint8Array(4 * 1024 * 1024 + 1)
    globalThis.fetch.mockResolvedValue(imageResponse(big))
    const res = await fromUrl('https://example.com/huge.png')
    expect(res.status).toBe(413)
    expect(putBlob).not.toHaveBeenCalled()
  })

  it('stores a public image for the owner of the draft', async () => {
    globalThis.fetch.mockResolvedValue(imageResponse(new Uint8Array([137, 80, 78, 71])))
    const res = await fromUrl('https://example.com/photo.png')
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.sourceUrl).toBe('https://example.com/photo.png')
    expect(body.url).toMatch(new RegExp(`/drafts/${alice.id}/${draft.id}/`))
    expect(vi.mocked(globalThis.fetch).mock.calls[0][1]).toMatchObject({ redirect: 'manual' })
  })

  it('refuses a draft the caller does not own (404) and requires a session', async () => {
    const bob = await db.insertUser({ github_id: 2, login: 'bob' })
    const bobCookie = await db.cookieFor(bob)
    expect((await fromUrl('https://example.com/a.png', bobCookie)).status).toBe(404)
    expect((await fromUrl('https://example.com/a.png', null)).status).toBe(401)
  })
})
