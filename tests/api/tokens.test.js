// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({ putBlob: vi.fn(), deleteBlobUrls: vi.fn(async () => {}) }))

import { route } from '../../server/router.js'
import { createApiToken } from '../../server/tokens.js'
import { issuePair } from '../../server/oauth/tokens.js'
import { apiRequest, setupTestDb } from './helpers/db.js'

let db
let alice
let aliceCookie

beforeAll(async () => {
  db = await setupTestDb()
})

beforeEach(async () => {
  await db.reset()
  alice = await db.insertUser({ github_id: 1, login: 'alice' })
  aliceCookie = await db.cookieFor(alice)
})

afterEach(() => {
  vi.clearAllMocks()
})

const bearer = (token) => ({ authorization: `Bearer ${token}` })

async function newToken(name = 'agent') {
  return createApiToken(alice.id, { name })
}

describe('creating tokens', () => {
  it('a browser session creates a token; the plaintext is returned once and stored only as a hash', async () => {
    const res = await route(
      apiRequest('/api/tokens', { method: 'POST', cookie: aliceCookie, body: { name: 'laptop', expires_in_days: 7 } })
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.token).toMatch(/^xt_[A-Za-z0-9_-]{40,}$/)
    expect(body.prefix).toBe(body.token.slice(0, 10))

    const { rows } = await db.pg.query('select token_hash, token_prefix from api_tokens where id = $1', [body.id])
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(rows[0].token_hash).not.toContain(body.token)
  })

  it('a bearer token cannot create tokens (403)', async () => {
    const { token } = await newToken()
    const res = await route(apiRequest('/api/tokens', { method: 'POST', headers: bearer(token), body: { name: 'x' } }))
    expect(res.status).toBe(403)
  })

  it('rejects an empty name and an out-of-range expiry', async () => {
    const noName = await route(apiRequest('/api/tokens', { method: 'POST', cookie: aliceCookie, body: { name: '  ' } }))
    expect(noName.status).toBe(400)
    const tooLong = await route(
      apiRequest('/api/tokens', { method: 'POST', cookie: aliceCookie, body: { name: 'x', expires_in_days: 366 } })
    )
    expect(tooLong.status).toBe(400)
  })

  it('refuses the 21st active token with 409', async () => {
    for (let i = 0; i < 20; i++) await newToken(`t${i}`)
    const res = await route(apiRequest('/api/tokens', { method: 'POST', cookie: aliceCookie, body: { name: 'extra' } }))
    expect(res.status).toBe(409)
  })
})

describe('listing and revoking', () => {
  it('lists tokens without the hash', async () => {
    await newToken()
    const res = await route(apiRequest('/api/tokens', { cookie: aliceCookie }))
    const { tokens } = await res.json()
    expect(tokens).toHaveLength(1)
    expect(JSON.stringify(tokens)).not.toMatch(/token_hash|[0-9a-f]{64}/)
  })

  it('a revoked token gets 401 afterwards', async () => {
    const { token, id } = await newToken()
    const ok = await route(apiRequest('/api/auth/me', { headers: bearer(token) }))
    expect((await ok.json()).auth).toBe('token')

    const revoke = await route(apiRequest(`/api/tokens/${id}`, { method: 'DELETE', cookie: aliceCookie }))
    expect(revoke.status).toBe(200)
    const after = await route(apiRequest('/api/drafts?published=false', { headers: bearer(token) }))
    expect(after.status).toBe(401)
  })

  it('cannot revoke another user token (404)', async () => {
    const bob = await db.insertUser({ github_id: 2, login: 'bob' })
    const { id } = await createApiToken(bob.id, { name: 'bobs' })
    const res = await route(apiRequest(`/api/tokens/${id}`, { method: 'DELETE', cookie: aliceCookie }))
    expect(res.status).toBe(404)
  })

  it('an expired token gets 401', async () => {
    const { token, id } = await newToken()
    await db.pg.query("update api_tokens set expires_at = now() - interval '1 day' where id = $1", [id])
    const res = await route(apiRequest('/api/auth/me', { headers: bearer(token) }))
    expect(res.status).toBe(401)
  })
})

describe('OAuth access tokens cannot manage personal tokens', () => {
  const API = 'https://app.test/api'

  async function oauthAccessToken() {
    await db.pg.query(
      "insert into oauth_clients (client_id, kind, client_name) values ('xtc_test_client', 'registered', 'Test') on conflict do nothing"
    )
    const { rows } = await db.pg.query(
      "insert into oauth_grants (user_id, client_id, scope, resource) values ($1, 'xtc_test_client', 'drafts', $2) returning id",
      [alice.id, API]
    )
    return (await issuePair(rows[0].id)).access_token
  }

  it('GET /api/tokens gets 403 for an OAuth access token', async () => {
    await newToken()
    const access = await oauthAccessToken()
    const res = await route(apiRequest('/api/tokens', { headers: bearer(access) }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/OAuth grant/)
  })

  it('DELETE /api/tokens/:id gets 403 for an OAuth access token and the token is not revoked', async () => {
    const { token, id } = await newToken()
    const access = await oauthAccessToken()
    const res = await route(apiRequest(`/api/tokens/${id}`, { method: 'DELETE', headers: bearer(access) }))
    expect(res.status).toBe(403)
    const { rows } = await db.pg.query('select revoked_at from api_tokens where id = $1', [id])
    expect(rows[0].revoked_at).toBeNull()
    const still = await route(apiRequest('/api/auth/me', { headers: bearer(token) }))
    expect(still.status).toBe(200)
  })

  it('a browser session still lists and revokes tokens', async () => {
    const { id } = await newToken()
    const list = await route(apiRequest('/api/tokens', { cookie: aliceCookie }))
    expect(list.status).toBe(200)
    expect((await list.json()).tokens).toHaveLength(1)
    const revoke = await route(apiRequest(`/api/tokens/${id}`, { method: 'DELETE', cookie: aliceCookie }))
    expect(revoke.status).toBe(200)
  })

  it('a hand-made xt_ token still lists its owner tokens', async () => {
    const { token } = await newToken()
    const res = await route(apiRequest('/api/tokens', { headers: bearer(token) }))
    expect(res.status).toBe(200)
  })
})

describe('7-day cap on hand-made tokens (plan D4)', () => {
  it('defaults to 7 days', async () => {
    const created = await createApiToken(alice.id, { name: 'default' })
    const { rows } = await db.pg.query(
      'select extract(epoch from (expires_at - now())) as secs from api_tokens where id = $1',
      [created.id]
    )
    expect(Number(rows[0].secs)).toBeGreaterThan(7 * 86400 - 120)
    expect(Number(rows[0].secs)).toBeLessThanOrEqual(7 * 86400)
  })

  it('accepts 1 and 7 days', async () => {
    for (const days of [1, 7]) {
      const res = await route(
        apiRequest('/api/tokens', { method: 'POST', cookie: aliceCookie, body: { name: `d${days}`, expires_in_days: days } })
      )
      expect(res.status).toBe(201)
    }
  })

  it('refuses 8 days with 400', async () => {
    const res = await route(
      apiRequest('/api/tokens', { method: 'POST', cookie: aliceCookie, body: { name: 'x', expires_in_days: 8 } })
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/from 1 to 7/)
    await expect(createApiToken(alice.id, { name: 'x', expiresInDays: 8 })).rejects.toMatchObject({ status: 400 })
  })

  it('refuses 0 days', async () => {
    await expect(createApiToken(alice.id, { name: 'x', expiresInDays: 0 })).rejects.toMatchObject({ status: 400 })
  })
})

describe('authentication precedence and CSRF', () => {
  it('an invalid bearer never falls back to a valid cookie', async () => {
    const res = await route(
      apiRequest('/api/drafts?published=false', { cookie: aliceCookie, headers: bearer('xt_' + 'a'.repeat(40)) })
    )
    expect(res.status).toBe(401)
  })

  it('a bearer request with a foreign Origin is still allowed', async () => {
    const { token } = await newToken()
    const res = await route(
      apiRequest('/api/drafts', {
        method: 'POST',
        headers: bearer(token),
        origin: 'https://evil.example',
        body: { title: 'from agent', posts: [] }
      })
    )
    expect(res.status).toBe(201)
  })

  it('a cookie request with a foreign Origin is refused (403)', async () => {
    const res = await route(
      apiRequest('/api/drafts', { method: 'POST', cookie: aliceCookie, origin: 'https://evil.example', body: { title: 'x', posts: [] } })
    )
    expect(res.status).toBe(403)
  })
})
