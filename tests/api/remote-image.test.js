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
import { makePng } from './helpers/images.js'

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
    ['::ffff:10.0.0.1'],
    ['::ffff:7f00:1'],
    ['::ffff:a9fe:a9fe'],
    ['::7f00:1'],
    ['64:ff9b::a9fe:a9fe'],
    ['2002:7f00:1::'],
    ['2001:0:1::1'],
    ['::ffff:0:127.0.0.1'],
    ['::ffff:0:a9fe:a9fe']
  ])('treats %s as private', (address) => {
    expect(isPrivateAddress(address)).toBe(true)
  })

  it.each([['93.184.216.34'], ['8.8.8.8'], ['2606:4700:4700::1111'], ['::ffff:5db8:d822'], ['2002:5db8:d822::']])('treats %s as public', (address) => {
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

  const redirect = (location, status = 302) => new Response(null, { status, headers: { location } })

  it('follows a 302 to a public image and stores it', async () => {
    globalThis.fetch.mockResolvedValueOnce(redirect('https://cdn.example.com/b.png'))
    globalThis.fetch.mockResolvedValueOnce(imageResponse(makePng()))
    const res = await fromUrl('https://example.com/a.png')
    expect(res.status).toBe(201)
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    expect(String(globalThis.fetch.mock.calls[1][0])).toBe('https://cdn.example.com/b.png')
    expect(globalThis.fetch.mock.calls[1][1]).toMatchObject({ redirect: 'manual' })
  })

  it('resolves a relative Location against the current URL', async () => {
    globalThis.fetch.mockResolvedValueOnce(redirect('/img/b.png'))
    globalThis.fetch.mockResolvedValueOnce(imageResponse(makePng()))
    expect((await fromUrl('https://example.com/a.png')).status).toBe(201)
    expect(String(globalThis.fetch.mock.calls[1][0])).toBe('https://example.com/img/b.png')
  })

  it.each([
    ['a private IP', 'http://10.0.0.1/x'],
    ['a name that resolves to a private IP', 'http://rebind.test/x'],
    ['credentials', 'https://user:pass@example.com/x'],
    ['ftp', 'ftp://example.com/x'],
    ['a mapped IPv6 metadata address', 'http://[::ffff:169.254.169.254]/x'],
    ['a protocol-relative private IP', '//10.0.0.1/x']
  ])('refuses a 302 to %s before the second fetch', async (_name, location) => {
    globalThis.fetch.mockResolvedValue(redirect(location))
    const res = await fromUrl('https://example.com/a.png')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/not allowed|Invalid URL|credentials|Only http/)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it.each([307, 308, 301, 303])('follows a %i redirect', async (status) => {
    globalThis.fetch.mockResolvedValueOnce(redirect('https://cdn.example.com/b.png', status))
    globalThis.fetch.mockResolvedValueOnce(imageResponse(makePng()))
    expect((await fromUrl('https://example.com/a.png')).status).toBe(201)
  })

  it('refuses a redirect with no Location', async () => {
    globalThis.fetch.mockResolvedValue(new Response(null, { status: 302 }))
    expect((await fromUrl('https://example.com/a.png')).status).toBe(502)
  })

  it('re-resolves every hop', async () => {
    const resolver = vi.fn(async () => [{ address: PUBLIC_IP, family: 4 }])
    setResolverForTests(resolver)
    globalThis.fetch.mockResolvedValueOnce(redirect('https://b.example/x'))
    globalThis.fetch.mockResolvedValueOnce(redirect('https://c.example/x'))
    globalThis.fetch.mockResolvedValueOnce(imageResponse(makePng()))
    expect((await fromUrl('https://a.example/x')).status).toBe(201)
    expect(resolver.mock.calls.map((c) => c[0])).toEqual(['a.example', 'b.example', 'c.example'])
  })

  it('accepts 3 redirects and refuses a 4th', async () => {
    globalThis.fetch.mockImplementation(async () => redirect('https://example.com/next'))
    const res = await fromUrl('https://example.com/a.png')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/redirects too many times/)
    expect(globalThis.fetch).toHaveBeenCalledTimes(4)
  })

  it('gives every hop the same abort signal, which also covers DNS', async () => {
    const signals = []
    globalThis.fetch.mockImplementationOnce(async (_u, init) => (signals.push(init.signal), redirect('https://example.com/next')))
    globalThis.fetch.mockImplementationOnce(async (_u, init) => (signals.push(init.signal), imageResponse(makePng())))
    expect((await fromUrl('https://example.com/a.png')).status).toBe(201)
    expect(signals).toHaveLength(2)
    expect(signals[0]).toBe(signals[1])
  })

  it('stops when the shared limit passes during a slow DNS answer on a later hop', async () => {
    const controller = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    let calls = 0
    setResolverForTests(() => (++calls === 1 ? Promise.resolve([{ address: PUBLIC_IP, family: 4 }]) : new Promise(() => {})))
    globalThis.fetch.mockImplementationOnce(async () => {
      setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), 5)
      return redirect('https://slow.example/next')
    })
    const res = await fromUrl('https://example.com/a.png')
    expect(res.status).toBe(502)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    vi.mocked(AbortSignal.timeout).mockRestore()
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
    globalThis.fetch.mockResolvedValue(imageResponse(makePng()))
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

describe('pinned connection (M7, B12)', () => {
  it('refuses a host whose answer mixes a public and a private address, without fetching', async () => {
    setResolverForTests(async () => [
      { address: PUBLIC_IP, family: 4 },
      { address: '10.9.9.9', family: 4 }
    ])
    const res = await fromUrl('https://images.example/cat.png')
    expect(res.status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('resolves the host once per fetch and connects through the checked address', async () => {
    const resolver = vi.fn(async () => [{ address: PUBLIC_IP, family: 4 }])
    setResolverForTests(resolver)
    fetch.mockResolvedValueOnce(imageResponse(makePng()))
    const res = await fromUrl('https://images.example/cat.png')
    expect(res.status).toBe(201)
    expect(resolver).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('connects through a dispatcher that is pinned to the checked address, with redirects off', async () => {
    fetch.mockResolvedValueOnce(imageResponse(makePng()))
    await fromUrl('https://images.example/cat.png')
    const init = fetch.mock.calls[0][1]
    expect(init.redirect).toBe('manual')
    expect(init.dispatcher).toBeDefined()
    expect(typeof init.dispatcher.close).toBe('function')
  })
})
