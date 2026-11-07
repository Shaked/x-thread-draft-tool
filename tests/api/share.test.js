// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({
  putBlob: vi.fn(),
  deleteBlobUrls: vi.fn(async () => {})
}))

import { route } from '../../server/router.js'
import { apiRequest, setupTestDb } from './helpers/db.js'

let db
let alice
let aliceCookie
let draft

beforeAll(async () => {
  db = await setupTestDb()
})

beforeEach(async () => {
  await db.reset()
  alice = await db.insertUser({ github_id: 1, login: 'alice', name: 'Alice Example', avatar_url: null })
  aliceCookie = await db.cookieFor(alice)
  draft = await db.insertDraft(alice.id, {
    title: 'Launch thread',
    posts: [{ id: 'p1', text: 'First post', images: [], embeddedTweet: null }]
  })
})

async function createToken() {
  const res = await route(apiRequest(`/api/drafts/${draft.id}/share-tokens`, { method: 'POST', cookie: aliceCookie }))
  return (await res.json()).token
}

describe('GET /api/share/:token', () => {
  it('serves markdown once, then reports the link as expired', async () => {
    const token = await createToken()

    const first = await route(apiRequest(`/api/share/${token}.md`))
    expect(first.status).toBe(200)
    expect(first.headers.get('content-type')).toContain('text/markdown')
    expect(first.headers.get('x-robots-tag')).toBe('noindex')
    expect(first.headers.get('cache-control')).toBe('no-store')
    const body = await first.text()
    expect(body).toContain('# Launch thread')
    expect(body).toContain('First post')

    const second = await route(apiRequest(`/api/share/${token}.md`))
    expect(second.status).toBe(410)
  })

  it('serves HTML with the author when asked for html, via extension or query', async () => {
    const tokenA = await createToken()
    const viaExtension = await route(apiRequest(`/api/share/${tokenA}.html`))
    expect(viaExtension.status).toBe(200)
    expect(viaExtension.headers.get('content-type')).toContain('text/html')
    const html = await viaExtension.text()
    expect(html).toContain('Alice Example')
    expect(html).toContain('@alice')

    const tokenB = await createToken()
    const viaQuery = await route(apiRequest(`/api/share/${tokenB}?format=html`))
    expect(viaQuery.status).toBe(200)
    expect(viaQuery.headers.get('content-type')).toContain('text/html')
  })

  it('lets exactly one of two concurrent requests consume the token', async () => {
    const token = await createToken()
    const [a, b] = await Promise.all([
      route(apiRequest(`/api/share/${token}.md`)),
      route(apiRequest(`/api/share/${token}.md`))
    ])
    expect([a.status, b.status].sort()).toEqual([200, 410])
  })

  it('returns 400 for a token that is not a UUID and 410 for an unknown UUID', async () => {
    expect((await route(apiRequest('/api/share/not-a-token.md'))).status).toBe(400)
    const unknown = '00000000-0000-4000-8000-000000000000'
    expect((await route(apiRequest(`/api/share/${unknown}.md`))).status).toBe(410)
  })

  it('is public: no session cookie is needed', async () => {
    const token = await createToken()
    const res = await route(apiRequest(`/api/share/${token}.md`))
    expect(res.status).toBe(200)
  })
})
