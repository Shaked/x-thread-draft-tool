// @vitest-environment node
import { createHash } from 'node:crypto'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({ putBlob: vi.fn(), deleteBlobUrls: vi.fn(async () => {}) }))

import { route } from '../../server/router.js'
import { authenticate } from '../../server/session.js'
import { setQueryImpl } from '../../server/db.js'
import { issuePair, resolveAccess, rotate, OAuthError } from '../../server/oauth/tokens.js'
import { apiRequest, setupTestDb, APP_URL } from './helpers/db.js'

const API = `${APP_URL}/api`
const MCP = `${APP_URL}/api/mcp`
const CLIENT = 'xtc_test_client'
const OTHER_CLIENT = 'xtc_other_client'

let db
let alice

beforeAll(async () => {
  db = await setupTestDb()
})

// Runs statements against PGlite; failWhen() swaps in a version that throws for matching SQL.
const passthrough = async (text, params = []) => {
  const result = await db.pg.query(text, params)
  return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length }
}
function failWhen(pattern) {
  setQueryImpl(async (text, params = []) => {
    if (pattern.test(text)) throw new Error('injected statement failure')
    return passthrough(text, params)
  })
}

beforeEach(async () => {
  setQueryImpl(passthrough)
  await db.reset()
  await db.pg.exec('truncate oauth_clients cascade')
  await db.pg.query("insert into oauth_clients (client_id, kind, client_name) values ($1, 'registered', 'Test'), ($2, 'registered', 'Other')", [
    CLIENT,
    OTHER_CLIENT
  ])
  alice = await db.insertUser({ github_id: 1, login: 'alice' })
})

afterEach(() => {
  vi.clearAllMocks()
})

async function newGrant({ resource = API, clientId = CLIENT } = {}) {
  const { rows } = await db.pg.query(
    `insert into oauth_grants (user_id, client_id, scope, resource) values ($1, $2, 'drafts', $3) returning id`,
    [alice.id, clientId, resource]
  )
  return rows[0].id
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const bearer = (token) => ({ authorization: `Bearer ${token}` })

async function expectInvalidGrant(promise) {
  await expect(promise).rejects.toBeInstanceOf(OAuthError)
  await expect(promise).rejects.toMatchObject({ code: 'invalid_grant' })
}

describe('issuing a pair', () => {
  it('returns xta_ and xtr_ tokens of 32 random bytes, with the token response fields', async () => {
    const grantId = await newGrant()
    const pair = await issuePair(grantId)
    expect(pair).toEqual({
      access_token: expect.stringMatching(/^xta_[A-Za-z0-9_-]{43}$/),
      refresh_token: expect.stringMatching(/^xtr_[A-Za-z0-9_-]{43}$/),
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'drafts'
    })
    expect(pair.access_token).not.toBe(pair.refresh_token)
  })

  it('stores only SHA-256 hashes, never the plaintext', async () => {
    const pair = await issuePair(await newGrant())
    const { rows } = await db.pg.query('select token_hash, kind from oauth_tokens')
    const hashes = rows.map((r) => r.token_hash)
    expect(hashes).toEqual(expect.arrayContaining([sha256(pair.access_token), sha256(pair.refresh_token)]))
    for (const hash of hashes) expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(rows)).not.toContain(pair.access_token)
    expect(JSON.stringify(rows)).not.toContain(pair.refresh_token)
  })

  it('access expires in 1 hour and refresh in 90 days', async () => {
    const pair = await issuePair(await newGrant())
    const { rows } = await db.pg.query(
      `select kind, extract(epoch from (expires_at - now())) as secs from oauth_tokens order by kind`
    )
    const byKind = Object.fromEntries(rows.map((r) => [r.kind, Number(r.secs)]))
    expect(byKind.access).toBeGreaterThan(3600 - 120)
    expect(byKind.access).toBeLessThanOrEqual(3600)
    expect(byKind.refresh).toBeGreaterThan(90 * 86400 - 120)
    expect(byKind.refresh).toBeLessThanOrEqual(90 * 86400)
    expect(pair.expires_in).toBe(3600)
  })

  it('deletes tokens that expired more than a day ago, and keeps recent ones', async () => {
    const grantId = await newGrant()
    await db.pg.query(
      `insert into oauth_tokens (token_hash, grant_id, kind, expires_at) values
         ('old-hash', $1, 'access', now() - interval '2 days'),
         ('recent-hash', $1, 'access', now() - interval '1 hour')`,
      [grantId]
    )
    await issuePair(grantId)
    const { rows } = await db.pg.query("select token_hash from oauth_tokens where token_hash in ('old-hash', 'recent-hash')")
    expect(rows.map((r) => r.token_hash)).toEqual(['recent-hash'])
  })
})

describe('resolving an access token', () => {
  it('returns the user for the audience it was issued for', async () => {
    const pair = await issuePair(await newGrant())
    const caller = await resolveAccess(pair.access_token, API)
    expect(caller).toMatchObject({ uid: alice.id, gh: '1', login: 'alice', via: 'oauth' })
    expect(caller.grantId).toEqual(expect.any(String))
  })

  it('refuses a token for another resource (audience binding)', async () => {
    const pair = await issuePair(await newGrant({ resource: MCP }))
    expect(await resolveAccess(pair.access_token, API)).toBeNull()
    expect(await resolveAccess(pair.access_token, MCP)).not.toBeNull()
  })

  it('refuses a refresh token, an unknown token and a malformed one', async () => {
    const pair = await issuePair(await newGrant())
    expect(await resolveAccess(pair.refresh_token, API)).toBeNull()
    expect(await resolveAccess(`xta_${'a'.repeat(43)}`, API)).toBeNull()
    expect(await resolveAccess('xta_short', API)).toBeNull()
    expect(await resolveAccess(undefined, API)).toBeNull()
  })

  it('refuses an expired access token', async () => {
    const pair = await issuePair(await newGrant())
    await db.pg.query("update oauth_tokens set expires_at = now() - interval '1 second' where token_hash = $1", [
      sha256(pair.access_token)
    ])
    expect(await resolveAccess(pair.access_token, API)).toBeNull()
  })

  it('refuses every token of a revoked grant', async () => {
    const grantId = await newGrant()
    const pair = await issuePair(grantId)
    await db.pg.query('update oauth_grants set revoked_at = now() where id = $1', [grantId])
    expect(await resolveAccess(pair.access_token, API)).toBeNull()
  })

  it('authenticate() accepts a bearer xta_ token for the REST API resource', async () => {
    const pair = await issuePair(await newGrant({ resource: API }))
    const ok = await authenticate(apiRequest('/api/drafts', { headers: bearer(pair.access_token) }))
    expect(ok).toMatchObject({ uid: alice.id, via: 'oauth' })
  })

  it('a token granted for the MCP resource is refused by the REST API (audience mismatch)', async () => {
    const pair = await issuePair(await newGrant({ resource: MCP }))
    const res = await route(apiRequest('/api/drafts', { headers: bearer(pair.access_token) }))
    expect(res.status).toBe(401)
  })

  it('an expired xta_ token on the REST API gets 401 and no cookie fallback', async () => {
    const pair = await issuePair(await newGrant())
    await db.pg.query("update oauth_tokens set expires_at = now() - interval '1 second' where token_hash = $1", [
      sha256(pair.access_token)
    ])
    const res = await route(apiRequest('/api/auth/me', { headers: bearer(pair.access_token) }))
    expect(res.status).toBe(401)
  })

  it('a valid xta_ token works on the REST API', async () => {
    const pair = await issuePair(await newGrant())
    const res = await route(apiRequest('/api/auth/me', { headers: bearer(pair.access_token) }))
    expect(res.status).toBe(200)
    expect((await res.json()).auth).toBe('oauth')
  })
})

describe('rotating a refresh token', () => {
  it('exchanges a valid refresh token for a new pair and spends the old one', async () => {
    const grantId = await newGrant()
    const first = await issuePair(grantId)
    const second = await rotate(first.refresh_token, CLIENT)
    expect(second.access_token).not.toBe(first.access_token)
    expect(second.refresh_token).not.toBe(first.refresh_token)
    expect(await resolveAccess(second.access_token, API)).toMatchObject({ uid: alice.id })

    const { rows } = await db.pg.query('select used_at from oauth_tokens where token_hash = $1', [sha256(first.refresh_token)])
    expect(rows[0].used_at).not.toBeNull()
  })

  it('the new refresh token rotates again', async () => {
    const first = await issuePair(await newGrant())
    const second = await rotate(first.refresh_token, CLIENT)
    const third = await rotate(second.refresh_token, CLIENT)
    expect(third.refresh_token).toMatch(/^xtr_/)
  })

  it('sets last_used_at on the grant', async () => {
    const grantId = await newGrant()
    const first = await issuePair(grantId)
    await rotate(first.refresh_token, CLIENT)
    const { rows } = await db.pg.query('select last_used_at from oauth_grants where id = $1', [grantId])
    expect(rows[0].last_used_at).not.toBeNull()
  })

  it('reusing a spent refresh token is invalid_grant and revokes the whole grant', async () => {
    const grantId = await newGrant()
    const first = await issuePair(grantId)
    const second = await rotate(first.refresh_token, CLIENT)

    await expectInvalidGrant(rotate(first.refresh_token, CLIENT))

    const { rows } = await db.pg.query('select revoked_at from oauth_grants where id = $1', [grantId])
    expect(rows[0].revoked_at).not.toBeNull()
    expect(await resolveAccess(second.access_token, API)).toBeNull()
    await expectInvalidGrant(rotate(second.refresh_token, CLIENT))
  })

  it('an unknown or malformed refresh token is invalid_grant', async () => {
    await expectInvalidGrant(rotate(`xtr_${'b'.repeat(43)}`, CLIENT))
    await expectInvalidGrant(rotate('not-a-token', CLIENT))
    await expectInvalidGrant(rotate(undefined, CLIENT))
  })

  it('an expired refresh token is invalid_grant', async () => {
    const pair = await issuePair(await newGrant())
    await db.pg.query("update oauth_tokens set expires_at = now() - interval '1 second' where token_hash = $1", [
      sha256(pair.refresh_token)
    ])
    await expectInvalidGrant(rotate(pair.refresh_token, CLIENT))
  })

  it('a refresh token presented by another client is invalid_grant, and is not spent', async () => {
    const pair = await issuePair(await newGrant({ clientId: CLIENT }))
    await expectInvalidGrant(rotate(pair.refresh_token, OTHER_CLIENT))
    const { rows } = await db.pg.query('select used_at from oauth_tokens where token_hash = $1', [sha256(pair.refresh_token)])
    expect(rows[0].used_at).toBeNull()
    await expect(rotate(pair.refresh_token, CLIENT)).resolves.toMatchObject({ token_type: 'Bearer' })
  })

  it('a refresh with another resource is invalid_target, and the token is not spent', async () => {
    const pair = await issuePair(await newGrant({ resource: API }))
    const refused = rotate(pair.refresh_token, CLIENT, `${APP_URL}/api/other`)
    await expect(refused).rejects.toBeInstanceOf(OAuthError)
    await expect(refused).rejects.toMatchObject({ code: 'invalid_target', status: 400 })
    const { rows } = await db.pg.query('select used_at from oauth_tokens where token_hash = $1', [sha256(pair.refresh_token)])
    expect(rows[0].used_at).toBeNull()
    await expect(rotate(pair.refresh_token, CLIENT)).resolves.toMatchObject({ token_type: 'Bearer' })
  })

  it('a refresh with the grant resource, or with no resource, works', async () => {
    const first = await issuePair(await newGrant({ resource: API }))
    const second = await rotate(first.refresh_token, CLIENT, API)
    await expect(rotate(second.refresh_token, CLIENT)).resolves.toMatchObject({ token_type: 'Bearer' })
  })

  it('a revoked grant cannot rotate, and the token is not spent', async () => {
    const grantId = await newGrant()
    const pair = await issuePair(grantId)
    await db.pg.query('update oauth_grants set revoked_at = now() where id = $1', [grantId])
    await expectInvalidGrant(rotate(pair.refresh_token, CLIENT))
    const { rows } = await db.pg.query('select used_at from oauth_tokens where token_hash = $1', [sha256(pair.refresh_token)])
    expect(rows[0].used_at).toBeNull()
  })

  it('an access token cannot be used as a refresh token', async () => {
    const pair = await issuePair(await newGrant())
    await expectInvalidGrant(rotate(pair.access_token, CLIENT))
  })

  it('a failure while issuing the replacement leaves the original refresh token usable', async () => {
    const grantId = await newGrant()
    const first = await issuePair(grantId)
    failWhen(/insert into oauth_tokens/)
    await expect(rotate(first.refresh_token, CLIENT)).rejects.toThrow('injected statement failure')
    setQueryImpl(passthrough)

    const { rows } = await db.pg.query('select used_at from oauth_tokens where token_hash = $1', [sha256(first.refresh_token)])
    expect(rows[0].used_at).toBeNull()
    const grant = await db.pg.query('select revoked_at, last_used_at from oauth_grants where id = $1', [grantId])
    expect(grant.rows[0]).toEqual({ revoked_at: null, last_used_at: null })

    const second = await rotate(first.refresh_token, CLIENT)
    expect(await resolveAccess(second.access_token, API)).toMatchObject({ uid: alice.id })
  })

  it('a failure after the old token is spent rolls that spend back as well', async () => {
    const grantId = await newGrant()
    const first = await issuePair(grantId)
    failWhen(/update oauth_grants set last_used_at/)
    await expect(rotate(first.refresh_token, CLIENT)).rejects.toThrow('injected statement failure')
    setQueryImpl(passthrough)

    const { rows } = await db.pg.query("select count(*)::int as n from oauth_tokens where kind = 'refresh'")
    expect(rows[0].n).toBe(1)
    await expect(rotate(first.refresh_token, CLIENT)).resolves.toMatchObject({ token_type: 'Bearer' })
  })

  it('a failing cleanup does not fail the rotation, revoke the grant or spend anything', async () => {
    const grantId = await newGrant()
    const first = await issuePair(grantId)
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    failWhen(/delete from oauth_tokens/)

    const second = await rotate(first.refresh_token, CLIENT)
    expect(second).toMatchObject({ token_type: 'Bearer', expires_in: 3600 })
    expect(second.refresh_token).toMatch(/^xtr_/)
    expect(errorLog).toHaveBeenCalledWith('[oauth] token cleanup failed', expect.any(Error))

    setQueryImpl(passthrough)
    expect(await resolveAccess(second.access_token, API)).toMatchObject({ uid: alice.id })
    const grant = await db.pg.query('select revoked_at from oauth_grants where id = $1', [grantId])
    expect(grant.rows[0].revoked_at).toBeNull()
    const third = await rotate(second.refresh_token, CLIENT)
    expect(third.refresh_token).toMatch(/^xtr_/)

    failWhen(/delete from oauth_tokens/)
    await expect(issuePair(grantId)).resolves.toMatchObject({ token_type: 'Bearer' })
    setQueryImpl(passthrough)
    errorLog.mockRestore()
  })

  it('reuse still revokes the grant after a rotation that had a failing cleanup', async () => {
    const grantId = await newGrant()
    const first = await issuePair(grantId)
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    failWhen(/delete from oauth_tokens/)
    const second = await rotate(first.refresh_token, CLIENT)
    setQueryImpl(passthrough)
    errorLog.mockRestore()

    await expectInvalidGrant(rotate(first.refresh_token, CLIENT))
    expect(await resolveAccess(second.access_token, API)).toBeNull()
  })

  it('two concurrent rotations: exactly one succeeds', async () => {
    const pair = await issuePair(await newGrant())
    const results = await Promise.allSettled([
      rotate(pair.refresh_token, CLIENT),
      rotate(pair.refresh_token, CLIENT)
    ])
    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toMatchObject({ code: 'invalid_grant' })
  })
})
