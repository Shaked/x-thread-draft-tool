// @vitest-environment node
import { createHash, randomBytes } from 'node:crypto'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({ putBlob: vi.fn(), deleteBlobUrls: vi.fn(async () => {}) }))

import { route } from '../../server/router.js'
import { createApiToken, hashToken } from '../../server/tokens.js'
import { issuePair, rotate } from '../../server/oauth/tokens.js'
import { APP_URL, apiRequest, setupTestDb } from './helpers/db.js'

const API = `${APP_URL}/api`
const REDIRECT = 'http://localhost:9999/callback'

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

/** Registers a client (once per id) and returns its id. */
async function client(clientId = 'xtc_claude', clientName = 'Claude') {
  await db.pg.query(
    `insert into oauth_clients (client_id, kind, client_name, redirect_uris)
     values ($1, 'registered', $2, $3::text[]) on conflict (client_id) do nothing`,
    [clientId, clientName, `{${REDIRECT}}`]
  )
  return clientId
}

/** A grant of `userId` for `clientId`. Returns its id. */
async function grantFor(userId, clientId = 'xtc_claude', resource = API) {
  const { rows } = await db.pg.query(
    `insert into oauth_grants (user_id, client_id, scope, resource) values ($1, $2, 'drafts', $3) returning id`,
    [userId, clientId, resource]
  )
  return rows[0].id
}

/** An access token for a fresh grant of alice's. Returns the grant id and its pair. */
async function oauthPairFor(userId = alice.id, clientId = 'xtc_claude') {
  await client(clientId)
  const grantId = await grantFor(userId, clientId)
  return { grantId, pair: await issuePair(grantId) }
}

async function grantRevoked(grantId) {
  const { rows } = await db.pg.query('select revoked_at from oauth_grants where id = $1', [grantId])
  return rows[0].revoked_at !== null
}

describe('listing connected apps', () => {
  it('shows only the caller\'s grants', async () => {
    await oauthPairFor(alice.id, 'xtc_alice_app')
    const bob = await db.insertUser({ github_id: 2, login: 'bob' })
    await client('xtc_bob_app', 'Bob app')
    await grantFor(bob.id, 'xtc_bob_app')

    const res = await route(apiRequest('/api/grants', { cookie: aliceCookie }))
    expect(res.status).toBe(200)
    const { grants } = await res.json()
    expect(grants).toHaveLength(1)
    expect(grants[0].client_name).toBe('Claude')
    expect(JSON.stringify(grants)).not.toContain('Bob app')
  })

  it('returns the fields the settings page shows, and the redirect host', async () => {
    const { grantId } = await oauthPairFor()
    const { grants } = await (await route(apiRequest('/api/grants', { cookie: aliceCookie }))).json()
    expect(grants[0]).toMatchObject({
      id: grantId,
      client_name: 'Claude',
      kind: 'registered',
      redirect_host: 'localhost:9999',
      resource: API,
      scope: 'drafts',
      revoked_at: null,
      last_used_at: null
    })
    expect(grants[0].created_at).toBeTruthy()
  })

  it('shows a revoked grant as revoked and never includes tokens or hashes', async () => {
    const { grantId, pair } = await oauthPairFor()
    await route(apiRequest(`/api/grants/${grantId}`, { method: 'DELETE', cookie: aliceCookie }))
    const { grants } = await (await route(apiRequest('/api/grants', { cookie: aliceCookie }))).json()
    expect(grants[0].revoked_at).not.toBeNull()
    expect(JSON.stringify(grants)).not.toMatch(/xta_|xtr_|token_hash|code_hash/)
    expect(JSON.stringify(grants)).not.toContain(pair.access_token)
  })

  it('a personal xt_ token can list', async () => {
    const { token } = await createApiToken(alice.id, { name: 'laptop' })
    const res = await route(apiRequest('/api/grants', { headers: bearer(token) }))
    expect(res.status).toBe(200)
  })

  it('a browser session lists', async () => {
    const res = await route(apiRequest('/api/grants', { cookie: aliceCookie }))
    expect(res.status).toBe(200)
    expect((await res.json()).grants).toEqual([])
  })

  it('an OAuth access token is refused with 403', async () => {
    const { pair } = await oauthPairFor()
    const res = await route(apiRequest('/api/grants', { headers: bearer(pair.access_token) }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/OAuth grant/)
  })
})

describe('revoking a connected app', () => {
  it('a browser session revokes its grant; the access token stops working at once', async () => {
    const { grantId, pair } = await oauthPairFor()
    expect((await route(apiRequest('/api/drafts?published=false', { headers: bearer(pair.access_token) }))).status).toBe(200)

    const res = await route(apiRequest(`/api/grants/${grantId}`, { method: 'DELETE', cookie: aliceCookie }))
    expect(res.status).toBe(200)
    expect(await grantRevoked(grantId)).toBe(true)

    const after = await route(apiRequest('/api/drafts?published=false', { headers: bearer(pair.access_token) }))
    expect(after.status).toBe(401)
  })

  it('the refresh token of a revoked grant no longer rotates', async () => {
    const { grantId, pair } = await oauthPairFor()
    await route(apiRequest(`/api/grants/${grantId}`, { method: 'DELETE', cookie: aliceCookie }))
    await expect(rotate(pair.refresh_token, 'xtc_claude')).rejects.toMatchObject({ code: 'invalid_grant' })
  })

  it('an unused authorization code of a revoked grant can no longer be exchanged', async () => {
    await client()
    const grantId = await grantFor(alice.id)
    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const newCode = async () => {
      const code = randomBytes(32).toString('base64url')
      await db.pg.query(
        `insert into oauth_codes (code_hash, grant_id, redirect_uri, code_challenge, expires_at)
         values ($1, $2, $3, $4, now() + interval '60 seconds')`,
        [hashToken(code), grantId, REDIRECT, challenge]
      )
      return code
    }
    const exchange = (code) =>
      route(
        apiRequest('/api/oauth/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT,
            client_id: 'xtc_claude',
            code_verifier: verifier,
            resource: API
          }).toString()
        })
      )

    // Control: before revoking, the code exchanges.
    expect((await exchange(await newCode())).status).toBe(200)

    const pending = await newCode()
    await route(apiRequest(`/api/grants/${grantId}`, { method: 'DELETE', cookie: aliceCookie }))
    const res = await exchange(pending)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_grant')
  })

  it('leaves the caller\'s other grants working', async () => {
    const first = await oauthPairFor(alice.id, 'xtc_first')
    const second = await oauthPairFor(alice.id, 'xtc_second')
    await route(apiRequest(`/api/grants/${first.grantId}`, { method: 'DELETE', cookie: aliceCookie }))
    const res = await route(apiRequest('/api/drafts?published=false', { headers: bearer(second.pair.access_token) }))
    expect(res.status).toBe(200)
  })

  it('a personal xt_ token can revoke a grant', async () => {
    const { token } = await createApiToken(alice.id, { name: 'laptop' })
    const { grantId } = await oauthPairFor()
    const res = await route(apiRequest(`/api/grants/${grantId}`, { method: 'DELETE', headers: bearer(token) }))
    expect(res.status).toBe(200)
    expect(await grantRevoked(grantId)).toBe(true)
  })

  it('an OAuth access token cannot revoke a grant (403) and nothing is revoked', async () => {
    const mine = await oauthPairFor(alice.id, 'xtc_mine')
    const other = await oauthPairFor(alice.id, 'xtc_other')
    const res = await route(apiRequest(`/api/grants/${other.grantId}`, { method: 'DELETE', headers: bearer(mine.pair.access_token) }))
    expect(res.status).toBe(403)
    expect(await grantRevoked(other.grantId)).toBe(false)
  })

  it('cannot revoke another user\'s grant (404), and it stays active', async () => {
    const bob = await db.insertUser({ github_id: 2, login: 'bob' })
    await client('xtc_bob')
    const bobGrant = await grantFor(bob.id, 'xtc_bob')
    const res = await route(apiRequest(`/api/grants/${bobGrant}`, { method: 'DELETE', cookie: aliceCookie }))
    expect(res.status).toBe(404)
    expect(await grantRevoked(bobGrant)).toBe(false)
  })

  it('an unknown or malformed id is a 404', async () => {
    const unknown = await route(
      apiRequest('/api/grants/00000000-0000-4000-8000-000000000000', { method: 'DELETE', cookie: aliceCookie })
    )
    const malformed = await route(apiRequest('/api/grants/not-a-uuid', { method: 'DELETE', cookie: aliceCookie }))
    expect(unknown.status).toBe(404)
    expect(malformed.status).toBe(404)
  })

  it('revoking twice is harmless', async () => {
    const { grantId } = await oauthPairFor()
    const first = await route(apiRequest(`/api/grants/${grantId}`, { method: 'DELETE', cookie: aliceCookie }))
    const second = await route(apiRequest(`/api/grants/${grantId}`, { method: 'DELETE', cookie: aliceCookie }))
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
  })
})
