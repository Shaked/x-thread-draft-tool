// @vitest-environment node
// #283 (E273 Task 9): the web surface of the admin routes. The owner's browser session answers an admin route only
// with the header `x-xt-admin: 1`; every other caller gets the 404 of an unknown path. Seeded once, then looped.
import { createLocalJWKSet, decodeJwt, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({
  putBlob: vi.fn(),
  deleteBlobUrls: vi.fn(async () => {}),
  listBlobPrefix: vi.fn(async () => ({ files: [], truncated: false }))
}))

import { ROUTES, route } from '../../server/router.js'
import { adminPathOpen } from '../../server/admin/guard.js'
import { ciAudience, OIDC_ISSUER, setJwksForTests } from '../../server/oidc-ci.js'
import { issuePair } from '../../server/oauth/tokens.js'
import { createApiToken } from '../../server/tokens.js'
import { apiRequest, setupTestDb, APP_URL } from './helpers/db.js'

const API = `${APP_URL}/api`
const CLIENT = 'xtc_admin_web_test'
const REPO_ID = '1136002672'
const WORKFLOW_REF = 'Shaked/x-thread-draft-tool/.github/workflows/smoke-deployed.yml@refs/heads/main'
const NIL = '00000000-0000-4000-8000-000000000000'
const HEADER = { 'x-xt-admin': '1' }

let db
let admin
let normal
let adminCookie
let normalCookie
let xtToken
let oauthToken
let ciToken

beforeAll(async () => {
  db = await setupTestDb()
  await db.reset()
  await db.pg.exec('delete from oauth_clients')
  await db.pg.query("insert into oauth_clients (client_id, kind, client_name) values ($1, 'registered', 'Web test')", [CLIENT])
  admin = await db.insertUser({ github_id: 960015, login: 'shaked' })
  normal = await db.insertUser({ github_id: 1, login: 'alice' })
  adminCookie = await db.cookieFor(admin)
  normalCookie = await db.cookieFor(normal)
  xtToken = (await createApiToken(admin.id, { name: 'web test' })).token
  const { rows } = await db.pg.query(
    `insert into oauth_grants (user_id, client_id, scope, resource, admin_until) values ($1, $2, 'drafts', $3, now() + interval '1 day') returning id`,
    [admin.id, CLIENT, API]
  )
  oauthToken = (await issuePair(rows[0].id)).access_token

  // A CI identity token that verifies (same setup as tests/api/admin-guard.test.js).
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  setJwksForTests(createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'web-kid', alg: 'RS256', use: 'sig' }] }))
  const now = Math.floor(Date.now() / 1000)
  vi.stubEnv('CI_OIDC_ENABLED', '1')
  vi.stubEnv('VERCEL_ENV', 'preview')
  vi.stubEnv('CI_OIDC_REPOSITORY_ID', REPO_ID)
  vi.stubEnv('CI_OIDC_ALLOW_BRANCHES', '1')
  ciToken = await new SignJWT({
    repository_id: REPO_ID,
    workflow_ref: WORKFLOW_REF,
    job_workflow_ref: WORKFLOW_REF,
    event_name: 'workflow_dispatch',
    ref: 'refs/heads/main',
    runner_environment: 'github-hosted'
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'web-kid' })
    .setIssuer(OIDC_ISSUER)
    .setAudience(ciAudience('preview'))
    .setSubject('repo:Shaked/x-thread-draft-tool:ref:refs/heads/main')
    .setNotBefore(now - 5)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(privateKey)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('CI_OIDC_ENABLED', '1')
  vi.stubEnv('VERCEL_ENV', 'preview')
  vi.stubEnv('CI_OIDC_REPOSITORY_ID', REPO_ID)
  vi.stubEnv('CI_OIDC_ALLOW_BRANCHES', '1')
})

// Every admin route, with a harmless request: reads, and writes that the handler refuses before it changes anything.
const CASES = [
  ['GET', '/admin/status'],
  ['GET', '/admin/users'],
  ['GET', `/admin/users/${NIL}`],
  ['GET', '/admin/stats'],
  ['GET', '/admin/audit'],
  ['GET', '/admin/metrics'],
  ['GET', '/admin/metrics/series?name=requests'],
  ['POST', `/admin/users/${NIL}/suspend`, {}],
  ['POST', `/admin/users/${NIL}/unsuspend`, {}],
  ['POST', `/admin/users/${NIL}/delete`, {}]
]

const call = (method, path, { body, cookie, headers } = {}) => route(apiRequest(`/api${path}`, { method, body, cookie, headers }))
const rateCalls = async () => Number((await db.pg.query('select coalesce(sum(calls), 0) as n from mcp_rate_limits where user_id = $1', [admin.id])).rows[0].n)

describe('the web surface of the admin routes', () => {
  it('covers every admin route of the router', () => {
    const keys = CASES.map(([method, path]) => `${method} ${path.split('?')[0].replace(NIL, ':id')}`).sort()
    const routes = ROUTES.filter((entry) => entry.path.startsWith('/admin')).map((entry) => `${entry.method} ${entry.path}`).sort()
    expect(keys).toEqual(routes)
  })

  it('answers the admin session with the header (the normal answer, not the unknown-route 404)', async () => {
    for (const [method, path, body] of CASES) {
      const res = await call(method, path, { body, cookie: adminCookie, headers: HEADER })
      const text = await res.text()
      expect({ path, status: res.status !== 404 || !text.includes('"Not found"') }).toEqual({ path, status: true })
      if (method === 'GET' && !path.includes(NIL)) expect({ path, status: res.status }).toEqual({ path, status: 200 })
    }
  })

  it('answers 404, the unknown-route answer, to every other caller', async () => {
    const unknown = await call('GET', '/zz-no-such-route')
    const expected = { status: unknown.status, text: await unknown.text() }
    expect(expected.status).toBe(404)
    const callers = {
      'admin session without the header': { cookie: adminCookie },
      'normal user session with the header': { cookie: normalCookie, headers: HEADER },
      'admin xt_ token with the header': { headers: { ...HEADER, authorization: `Bearer ${xtToken}` } },
      'admin OAuth /api token with the header': { headers: { ...HEADER, authorization: `Bearer ${oauthToken}` } },
      'CI OIDC token with the header': { headers: { ...HEADER, authorization: `Bearer ${ciToken}` } },
      'admin session with a wrong header value': { cookie: adminCookie, headers: { 'x-xt-admin': 'true' } },
      'header only, no session': { headers: HEADER }
    }
    for (const [name, opts] of Object.entries(callers)) {
      for (const [method, path, body] of CASES) {
        const res = await call(method, path, { body, ...opts })
        expect({ name, path, status: res.status, text: await res.text() }).toEqual({ name, path, ...expected })
      }
    }
  })

  it('answers 404 for the admin session when ADMIN_DISABLED=1', async () => {
    vi.stubEnv('ADMIN_DISABLED', '1')
    for (const [method, path, body] of CASES) {
      expect((await call(method, path, { body, cookie: adminCookie, headers: HEADER })).status).toBe(404)
    }
  })

  it('answers 404 for a revoked session', async () => {
    const revoked = await db.cookieFor(admin)
    const { jti, exp } = decodeJwt(revoked.replace('xt_session=', ''))
    await db.pg.query('insert into revoked_sessions (jti, expires_at) values ($1, to_timestamp($2))', [jti, exp])
    for (const [method, path, body] of CASES) {
      expect((await call(method, path, { body, cookie: revoked, headers: HEADER })).status).toBe(404)
    }
  })

  it('refuses a cross-origin POST with the header (403) before the handler runs', async () => {
    const before = (await db.pg.query('select count(*)::int as n from admin_audit')).rows[0].n
    const res = await route(
      apiRequest(`/api/admin/users/${normal.id}/suspend`, {
        method: 'POST',
        body: { confirm_login: 'alice' },
        cookie: adminCookie,
        headers: HEADER,
        origin: 'https://evil.test'
      })
    )
    expect(res.status).toBe(403)
    expect((await db.pg.query('select suspended_at from users where id = $1', [normal.id])).rows[0].suspended_at).toBeNull()
    expect((await db.pg.query('select count(*)::int as n from admin_audit')).rows[0].n).toBe(before)
  })
})

describe('the gate cannot fail open', () => {
  it('resolves to exactly false for callers that are not the web admin', async () => {
    for (const opts of [{}, { cookie: normalCookie, headers: HEADER }, { cookie: adminCookie }, { headers: { ...HEADER, authorization: `Bearer ${xtToken}` }, cookie: adminCookie }]) {
      const result = adminPathOpen(apiRequest('/api/admin/status', opts))
      expect(result).toBeInstanceOf(Promise)
      expect(await result).toBe(false)
    }
  })

  it('resolves to exactly true for the admin session with the header, and does not count', async () => {
    const before = await rateCalls()
    expect(await adminPathOpen(apiRequest('/api/admin/status', { cookie: adminCookie, headers: HEADER }))).toBe(true)
    expect(await rateCalls()).toBe(before)
  })
})

describe('the rate count', () => {
  it('one web call adds exactly 1 to the per-minute row of mcp_rate_limits', async () => {
    const before = await rateCalls()
    const res = await call('GET', '/admin/status', { cookie: adminCookie, headers: HEADER })
    expect(res.status).toBe(200)
    expect(await rateCalls()).toBe(before + 1)
  })

  it('a refused call counts nothing', async () => {
    const before = await rateCalls()
    await call('GET', '/admin/status', { cookie: adminCookie })
    await call('GET', '/admin/status', { cookie: normalCookie, headers: HEADER })
    expect(await rateCalls()).toBe(before)
  })

  it('answers 429 past 120 calls in the minute', async () => {
    await db.pg.query(
      `insert into mcp_rate_limits (user_id, minute, calls) values ($1, date_trunc('minute', now()), 120)
       on conflict (user_id, minute) do update set calls = 120`,
      [admin.id]
    )
    expect((await call('GET', '/admin/status', { cookie: adminCookie, headers: HEADER })).status).toBe(429)
    await db.pg.query('delete from mcp_rate_limits where user_id = $1', [admin.id])
  })
})
