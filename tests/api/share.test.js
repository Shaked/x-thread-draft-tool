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

describe('share link lifetime and revoke', () => {
  let bob
  let bobCookie

  beforeEach(async () => {
    bob = await db.insertUser({ github_id: 2, login: 'bob' })
    bobCookie = await db.cookieFor(bob)
  })

  /** POST a share link for alice's draft; `body` undefined sends no body at all. */
  async function createLink(body, cookie = aliceCookie) {
    const res = await route(apiRequest(`/api/drafts/${draft.id}/share-tokens`, { method: 'POST', body, cookie }))
    return { res, data: res.status === 201 ? await res.json() : null }
  }

  const readLink = (token) => route(apiRequest(`/api/share/${token}.md`))
  const secondsFromNow = (iso) => (new Date(iso).getTime() - Date.now()) / 1000

  it('a link with an empty body gets the defaults: one-time, about one hour', async () => {
    const { res, data } = await createLink(undefined)
    expect(res.status).toBe(201)
    expect(data.one_time).toBe(true)
    expect(secondsFromNow(data.expires_at)).toBeGreaterThan(3500)
    expect(secondsFromNow(data.expires_at)).toBeLessThan(3700)
    expect(Object.keys(data).sort()).toEqual(['expires_at', 'one_time', 'token'])
  })

  it('an empty JSON object gets the same defaults', async () => {
    const { res, data } = await createLink({})
    expect(res.status).toBe(201)
    expect(data.one_time).toBe(true)
  })

  it('honours expires_in: about 60 seconds for 60', async () => {
    const { data } = await createLink({ expires_in: 60 })
    expect(secondsFromNow(data.expires_at)).toBeGreaterThan(50)
    expect(secondsFromNow(data.expires_at)).toBeLessThan(70)
  })

  it('refuses an expires_in outside 60 to 604800, or a non-integer, with 400', async () => {
    for (const expires_in of [59, 604801, 0, -1, 1.5, '3600', null]) {
      const { res } = await createLink({ expires_in })
      expect(res.status, JSON.stringify(expires_in)).toBe(400)
    }
    const { res } = await createLink({ one_time: 'yes' })
    expect(res.status).toBe(400)
  })

  it('refuses a body that is not JSON with 400, and creates no link', async () => {
    const res = await route(apiRequest(`/api/drafts/${draft.id}/share-tokens`, { method: 'POST', body: '{nope', cookie: aliceCookie }))
    expect(res.status).toBe(400)
  })

  it('a link is refused with 410 once its expires_at has passed', async () => {
    const { data } = await createLink({ one_time: false })
    expect((await readLink(data.token)).status).toBe(200)
    await db.pg.query("update share_tokens set expires_at = now() - interval '1 second' where token = $1", [data.token])
    expect((await readLink(data.token)).status).toBe(410)
  })

  it('a reusable link can be read twice', async () => {
    const { data } = await createLink({ one_time: false })
    const first = await readLink(data.token)
    const second = await readLink(data.token)
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await second.text()).toContain('# Launch thread')
  })

  it('a one-time link works once when asked for explicitly', async () => {
    const { data } = await createLink({ one_time: true })
    expect((await readLink(data.token)).status).toBe(200)
    expect((await readLink(data.token)).status).toBe(410)
  })

  it('revoking one link stops it at once and leaves the other links alone', async () => {
    const stopped = (await createLink({ one_time: false })).data.token
    const kept = (await createLink({ one_time: false })).data.token
    const res = await route(apiRequest(`/api/drafts/${draft.id}/share-tokens/${stopped}`, { method: 'DELETE', cookie: aliceCookie }))
    expect(res.status).toBe(204)
    expect((await readLink(stopped)).status).toBe(410)
    expect((await readLink(kept)).status).toBe(200)
  })

  it('revoking every link of the draft stops all of them', async () => {
    const a = (await createLink({ one_time: false })).data.token
    const b = (await createLink()).data.token
    const res = await route(apiRequest(`/api/drafts/${draft.id}/share-tokens`, { method: 'DELETE', cookie: aliceCookie }))
    expect(res.status).toBe(204)
    expect((await readLink(a)).status).toBe(410)
    expect((await readLink(b)).status).toBe(410)
  })

  it('another user cannot revoke a link (404), and the link still works', async () => {
    const token = (await createLink({ one_time: false })).data.token
    const one = await route(apiRequest(`/api/drafts/${draft.id}/share-tokens/${token}`, { method: 'DELETE', cookie: bobCookie }))
    const all = await route(apiRequest(`/api/drafts/${draft.id}/share-tokens`, { method: 'DELETE', cookie: bobCookie }))
    expect(one.status).toBe(404)
    expect(all.status).toBe(404)
    expect((await readLink(token)).status).toBe(200)
  })

  it('a revoke with a token that is not a uuid is 404', async () => {
    const res = await route(apiRequest(`/api/drafts/${draft.id}/share-tokens/not-a-token`, { method: 'DELETE', cookie: aliceCookie }))
    expect(res.status).toBe(404)
  })
})
