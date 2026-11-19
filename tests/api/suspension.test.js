// @vitest-environment node
// Admin plan A6: a suspended user is refused on every sign-in path, nothing is spent or changed, and
// everything works again after unsuspending. A second user is never affected.
import { createHash, randomBytes } from 'node:crypto'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({
  putBlob: vi.fn(async (pathname) => ({ url: `https://store.public.blob.vercel-storage.com/${pathname}` })),
  deleteBlobUrls: vi.fn(async () => {})
}))
vi.mock('../../server/remote-image.js', () => ({
  fetchRemoteImage: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' }))
}))

import { route } from '../../server/router.js'
import { admit, SUSPENDED_MESSAGE } from '../../server/suspension.js'
import { authenticate } from '../../server/session.js'
import { issuePair } from '../../server/oauth/tokens.js'
import { setMetadataResolverForTests } from '../../server/oauth/clients.js'
import { createApiToken } from '../../server/tokens.js'
import { ciAudience, OIDC_ISSUER, setJwksForTests } from '../../server/oidc-ci.js'
import { APP_URL, apiRequest, setupTestDb } from './helpers/db.js'

const API = `${APP_URL}/api`
const MCP = `${APP_URL}/api/mcp`
const REDIRECT = 'http://localhost:4000/cb'
const FORM = { 'content-type': 'application/x-www-form-urlencoded' }
const MODERN = '2026-07-28'
const REPO_ID = '1136002672'
const WORKFLOW_REF = 'Shaked/x-thread-draft-tool/.github/workflows/smoke-deployed.yml@refs/heads/main'
const IMAGE = 'https://store.public.blob.vercel-storage.com'

let db
let signingKey

beforeAll(async () => {
  db = await setupTestDb()
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  signingKey = privateKey
  setJwksForTests(createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'susp-kid', alg: 'RS256', use: 'sig' }] }))
})

beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  await db.reset()
  await db.pg.exec('delete from oauth_clients')
  vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn())
  setMetadataResolverForTests(async () => [{ address: '93.184.216.34' }])
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

// Takes a user row or the object `userWith` returns.
const idOf = (who) => (who.user ?? who).id
const suspend = (who) => db.pg.query('update users set suspended_at = now() where id = $1', [idOf(who)])
const unsuspend = (who) => db.pg.query('update users set suspended_at = null where id = $1', [idOf(who)])
const bearer = (token) => ({ authorization: `Bearer ${token}` })
const post = (path, body, opts = {}) => route(apiRequest(path, { method: 'POST', body, headers: { ...FORM }, ...opts }))

/** Everything that holds state a refused request must not change. */
async function snapshot() {
  const out = {}
  for (const table of ['drafts', 'api_tokens', 'oauth_grants', 'oauth_tokens', 'oauth_codes', 'share_tokens', 'mcp_rate_limits', 'revoked_sessions']) {
    out[table] = (await db.pg.query(`select * from ${table} order by 1`)).rows
  }
  return out
}

async function registerClient() {
  const res = await route(
    apiRequest('/api/oauth/register', {
      method: 'POST',
      body: { client_name: 'Test Client', redirect_uris: [REDIRECT] },
      headers: { 'content-type': 'application/json' }
    })
  )
  expect(res.status).toBe(201)
  return (await res.json()).client_id
}

function pkce() {
  const verifier = randomBytes(48).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

function authorizeQuery(clientId, challenge, resource = API) {
  return new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'st',
    resource
  }).toString()
}

/** The consent page and the signed decision token inside it. */
async function consentFor(cookie, clientId, challenge) {
  const page = await route(apiRequest(`/api/oauth/authorize?${authorizeQuery(clientId, challenge)}`, { cookie }))
  const html = await page.text()
  return { page, html, requestToken: html.match(/name="request" value="([^"]+)"/)?.[1] }
}

async function approveCode(cookie, clientId, challenge) {
  const { requestToken } = await consentFor(cookie, clientId, challenge)
  const res = await post('/api/oauth/authorize', new URLSearchParams({ request: requestToken, decision: 'approve' }).toString(), { cookie })
  expect(res.status).toBe(302)
  return new URL(res.headers.get('location')).searchParams.get('code')
}

const exchange = (code, clientId, verifier) =>
  post(
    '/api/oauth/token',
    new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier, resource: API }).toString()
  )

const refresh = (refreshToken, clientId) =>
  post('/api/oauth/token', new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId }).toString())

async function grantFor(user, resource, clientId = 'xtc_susp') {
  await db.pg.query("insert into oauth_clients (client_id, kind, client_name) values ($1, 'registered', 'Susp') on conflict do nothing", [clientId])
  const { rows } = await db.pg.query(
    "insert into oauth_grants (user_id, client_id, scope, resource) values ($1, $2, 'drafts', $3) returning id",
    [user.id, clientId, resource]
  )
  return rows[0].id
}

function mcpRequest(token, message, { modern = false } = {}) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` }
  const body = { jsonrpc: '2.0', id: 1, ...message }
  if (modern) {
    headers['mcp-protocol-version'] = MODERN
    headers['mcp-method'] = message.method
    if (message.method === 'tools/call') headers['mcp-name'] = message.params.name
    body.params = { ...(body.params ?? {}), _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN } }
  } else {
    headers['mcp-protocol-version'] = '2025-06-18'
  }
  return new Request(MCP, { method: 'POST', headers, body: JSON.stringify(body) })
}

async function ciToken() {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({
    repository_id: REPO_ID,
    workflow_ref: WORKFLOW_REF,
    job_workflow_ref: WORKFLOW_REF,
    event_name: 'workflow_dispatch',
    ref: 'refs/heads/main',
    runner_environment: 'github-hosted'
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'susp-kid' })
    .setIssuer(OIDC_ISSUER)
    .setAudience(ciAudience('preview'))
    .setSubject('repo:Shaked/x-thread-draft-tool:ref:refs/heads/main')
    .setNotBefore(now - 5)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(signingKey)
}

/** A user with every kind of credential, a draft and a share link. */
async function userWith(github_id, login) {
  const user = await db.insertUser({ github_id, login })
  const draft = await db.insertDraft(user.id)
  const cookie = await db.cookieFor(user)
  const xt = (await createApiToken(user.id, { name: 'susp' })).token
  const xta = (await issuePair(await grantFor(user, API, `xtc_api_${github_id}`))).access_token
  const mcp = (await issuePair(await grantFor(user, MCP, `xtc_mcp_${github_id}`))).access_token
  const shared = await route(apiRequest(`/api/drafts/${draft.id}/share-tokens`, { method: 'POST', cookie }))
  const share = (await shared.json()).token
  return { user, draft, cookie, xt, xta, mcp, share }
}

/** Each probe sends one request as `who`. `ok` is the status a normal user gets. */
const probes = {
  'cookie, GET /api/drafts': { ok: 200, send: (w) => route(apiRequest('/api/drafts?published=false', { cookie: w.cookie })) },
  'xt_ token, GET /api/drafts': { ok: 200, send: (w) => route(apiRequest('/api/drafts?published=false', { headers: bearer(w.xt) })) },
  'xta_ token, GET /api/drafts': { ok: 200, send: (w) => route(apiRequest('/api/drafts?published=false', { headers: bearer(w.xta) })) },
  'image upload': {
    ok: 201,
    send: (w) =>
      route(apiRequest(`/api/images?draftId=${w.draft.id}`, { method: 'POST', cookie: w.cookie, headers: { 'content-type': 'image/png' }, body: new Uint8Array([1, 2, 3]) }))
  },
  'image from URL': {
    ok: 201,
    send: (w) => route(apiRequest('/api/images/from-url', { method: 'POST', cookie: w.cookie, body: { draftId: w.draft.id, url: 'https://example.com/a.png' } }))
  },
  'image delete': {
    ok: 200,
    send: (w) => route(apiRequest('/api/images', { method: 'DELETE', cookie: w.cookie, body: { url: `${IMAGE}/drafts/${w.user.id}/${w.draft.id}/x.png` } }))
  }
}

describe('REST paths', () => {
  for (const [name, probe] of Object.entries(probes)) {
    it(`${name}: 403 with the message while suspended, nothing changes, works again after`, async () => {
      const alice = await userWith(1, 'alice')
      const bob = await userWith(2, 'bob')
      await suspend(alice)
      const before = await snapshot()

      const res = await probe.send(alice)
      expect(res.status).toBe(403)
      expect((await res.json()).error).toBe(SUSPENDED_MESSAGE)
      expect(await snapshot()).toEqual(before)

      // The second user is not affected.
      expect((await probe.send(bob)).status).toBe(probe.ok)

      await unsuspend(alice)
      expect((await probe.send(alice)).status).toBe(probe.ok)
    })
  }

  it('an xt_ token of a suspended user does not get last_used_at, and gets it again after', async () => {
    const alice = await userWith(1, 'alice')
    await suspend(alice)
    const lastUsed = async () => (await db.pg.query('select last_used_at from api_tokens where user_id = $1', [alice.user.id])).rows[0].last_used_at
    expect(await lastUsed()).toBeNull()
    expect((await probes['xt_ token, GET /api/drafts'].send(alice)).status).toBe(403)
    expect(await lastUsed()).toBeNull()
    await unsuspend(alice)
    expect((await probes['xt_ token, GET /api/drafts'].send(alice)).status).toBe(200)
    expect(await lastUsed()).not.toBeNull()
  })

  it('GET /api/auth/me answers 200 with suspended: true, for a cookie and for a token', async () => {
    const alice = await userWith(1, 'alice')
    const bob = await userWith(2, 'bob')
    await suspend(alice)
    for (const request of [apiRequest('/api/auth/me', { cookie: alice.cookie }), apiRequest('/api/auth/me', { headers: bearer(alice.xt) })]) {
      const res = await route(request)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ user: null, auth: null, suspended: true })
    }
    const normal = await (await route(apiRequest('/api/auth/me', { cookie: bob.cookie }))).json()
    expect(normal.user.login).toBe('bob')
    expect(normal.suspended).toBeUndefined()
    await unsuspend(alice)
    expect((await (await route(apiRequest('/api/auth/me', { cookie: alice.cookie }))).json()).user.login).toBe('alice')
  })

  it('the CI identity is refused when suspended and works again after', async () => {
    vi.stubEnv('CI_OIDC_ENABLED', '1')
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('CI_OIDC_REPOSITORY_ID', REPO_ID)
    vi.stubEnv('CI_OIDC_ALLOW_BRANCHES', '1')
    const ci = await ciToken()
    const me = () => route(apiRequest('/api/auth/me', { headers: bearer(ci) }))
    expect((await (await me()).json()).user.login).toBe('ci-smoke')
    await db.pg.query("update users set suspended_at = now() where github_id = -1")
    expect(await (await me()).json()).toEqual({ user: null, auth: null, suspended: true })
    await db.pg.query('update users set suspended_at = null where github_id = -1')
    expect((await (await me()).json()).user.login).toBe('ci-smoke')
  })

  it('a user row deleted with SQL: the old cookie gets 401', async () => {
    const alice = await userWith(1, 'alice')
    await db.pg.query('delete from users where id = $1', [alice.user.id])
    expect((await probes['cookie, GET /api/drafts'].send(alice)).status).toBe(401)
  })
})

describe('MCP', () => {
  const calls = async (uid) => (await db.pg.query('select count(*)::int as n from mcp_rate_limits where user_id = $1', [uid])).rows[0].n

  it.each([
    ['tools/list', { method: 'tools/list' }, false],
    ['tools/list (2026-07-28)', { method: 'tools/list' }, true],
    ['tools/call', { method: 'tools/call', params: { name: 'whoami', arguments: {} } }, false],
    ['tools/call (2026-07-28)', { method: 'tools/call', params: { name: 'whoami', arguments: {} } }, true]
  ])('%s: 403, no www-authenticate, no rate row; works again after', async (_name, message, modern) => {
    const alice = await userWith(1, 'alice')
    const bob = await userWith(2, 'bob')
    await suspend(alice)
    const before = await snapshot()

    const res = await route(mcpRequest(alice.mcp, message, { modern }))
    expect(res.status).toBe(403)
    expect(res.headers.get('www-authenticate')).toBeNull()
    expect(await res.json()).toEqual({ error: SUSPENDED_MESSAGE })
    expect(await calls(alice.user.id)).toBe(0)
    expect(await snapshot()).toEqual(before)

    expect((await route(mcpRequest(bob.mcp, message, { modern }))).status).toBe(200)
    await unsuspend(alice)
    expect((await route(mcpRequest(alice.mcp, message, { modern }))).status).toBe(200)
  })

  it('a suspended user with an unknown token still gets the normal 401', async () => {
    const res = await route(mcpRequest(`xta_${'A'.repeat(43)}`, { method: 'tools/list' }))
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain('Bearer')
  })
})

describe('OAuth', () => {
  it('refresh: invalid_grant with the message, the refresh token is not spent, works again after', async () => {
    const alice = await db.insertUser({ github_id: 1, login: 'alice' })
    const cookie = await db.cookieFor(alice)
    const clientId = await registerClient()
    const { verifier, challenge } = pkce()
    const done = await exchange(await approveCode(cookie, clientId, challenge), clientId, verifier)
    expect(done.status).toBe(200)
    const pair = await done.json()

    await suspend(alice)
    const before = await snapshot()
    const res = await refresh(pair.refresh_token, clientId)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_grant', error_description: SUSPENDED_MESSAGE })
    expect(await snapshot()).toEqual(before)

    await unsuspend(alice)
    expect((await refresh(pair.refresh_token, clientId)).status).toBe(200)
  })

  it('code exchange: invalid_grant, the code is not spent and the grant stays, works again after', async () => {
    const alice = await db.insertUser({ github_id: 1, login: 'alice' })
    const cookie = await db.cookieFor(alice)
    const clientId = await registerClient()
    const { verifier, challenge } = pkce()
    const code = await approveCode(cookie, clientId, challenge)

    await suspend(alice)
    const before = await snapshot()
    const res = await exchange(code, clientId, verifier)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_grant', error_description: SUSPENDED_MESSAGE })
    expect(await snapshot()).toEqual(before)

    await unsuspend(alice)
    expect((await exchange(code, clientId, verifier)).status).toBe(200)
  })

  it('consent page: the sign-in page is shown and no decision is accepted; works again after', async () => {
    const alice = await db.insertUser({ github_id: 1, login: 'alice' })
    const bob = await db.insertUser({ github_id: 2, login: 'bob' })
    const cookie = await db.cookieFor(alice)
    const clientId = await registerClient()
    const { challenge } = pkce()
    // A decision signed before the suspension must not work either.
    const { requestToken } = await consentFor(cookie, clientId, challenge)
    await suspend(alice)
    const before = await snapshot()

    const page = await consentFor(cookie, clientId, challenge)
    expect(page.page.status).toBe(200)
    expect(page.requestToken).toBeUndefined()
    expect(page.html).toContain('/api/auth/login?return_to=')

    const decision = await post('/api/oauth/authorize', new URLSearchParams({ request: requestToken, decision: 'approve' }).toString(), { cookie })
    expect(decision.status).toBe(403)
    expect(await snapshot()).toEqual(before)

    expect((await consentFor(await db.cookieFor(bob), clientId, challenge)).requestToken).toBeTruthy()
    await unsuspend(alice)
    expect((await consentFor(cookie, clientId, challenge)).requestToken).toBeTruthy()
  })

  it('an xta_ access token of a suspended user is refused (resolveAccess)', async () => {
    const alice = await userWith(1, 'alice')
    await suspend(alice)
    const res = await route(apiRequest('/api/drafts?published=false', { headers: bearer(alice.xta) }))
    expect(res.status).toBe(403)
  })
})

describe('sign-in', () => {
  function mockGithub(user) {
    globalThis.fetch.mockImplementation(async (input) => {
      const url = String(input)
      if (url === 'https://github.com/login/oauth/access_token') return Response.json({ access_token: 'gho_x' })
      if (url === 'https://api.github.com/user') return Response.json(user)
      throw new Error(`unexpected fetch ${url}`)
    })
  }

  it('login callback: redirect to /?suspended=1 and no xt_session cookie; a normal user gets the cookie', async () => {
    const octo = await db.insertUser({ github_id: 4242, login: 'octo' })
    mockGithub({ id: 4242, login: 'octo', name: 'Octo', avatar_url: null })
    await suspend(octo)
    const callback = () => route(apiRequest('/api/auth/callback?code=c&state=s', { cookie: 'xt_oauth_state=s' }))

    const res = await callback()
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`${APP_URL}/?suspended=1`)
    expect(res.headers.getSetCookie().some((c) => c.startsWith('xt_session='))).toBe(false)

    await unsuspend(octo)
    const ok = await callback()
    expect(ok.headers.get('location')).toBe(`${APP_URL}/`)
    expect(ok.headers.getSetCookie().some((c) => c.startsWith('xt_session=') && !c.includes('Max-Age=0'))).toBe(true)
  })

  it('device poll: 403 with the message and no grant; a normal user still gets a pair', async () => {
    const octo = await db.insertUser({ github_id: 555, login: 'octo' })
    globalThis.fetch.mockImplementation(async (input) => {
      const url = String(input)
      if (url === 'https://github.com/login/oauth/access_token') return Response.json({ access_token: 'gho_x' })
      if (url === 'https://api.github.com/user') return Response.json({ id: 555, login: 'octo', name: 'Octo', avatar_url: null })
      throw new Error(`unexpected fetch ${url}`)
    })
    const poll = () => route(apiRequest('/api/auth/device/poll', { method: 'POST', body: { device_code: 'device-123', name: 'claude' } }))
    await suspend(octo)
    const res = await poll()
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe(SUSPENDED_MESSAGE)
    expect((await db.pg.query('select count(*)::int as n from oauth_grants')).rows[0].n).toBe(0)
    expect((await db.pg.query('select count(*)::int as n from oauth_tokens')).rows[0].n).toBe(0)

    await unsuspend(octo)
    expect((await poll()).status).toBe(201)
  })
})

describe('share links', () => {
  it('a link of a suspended user answers 410 and is not used up; it works after unsuspending', async () => {
    const alice = await userWith(1, 'alice')
    const bob = await userWith(2, 'bob')
    await suspend(alice)
    const before = await snapshot()
    const res = await route(apiRequest(`/api/share/${alice.share}.md`))
    expect(res.status).toBe(410)
    expect(await snapshot()).toEqual(before)
    const row = (await db.pg.query('select used, used_at from share_tokens where token = $1', [alice.share])).rows[0]
    expect(row).toEqual({ used: false, used_at: null })

    expect((await route(apiRequest(`/api/share/${bob.share}.md`))).status).toBe(200)
    await unsuspend(alice)
    expect((await route(apiRequest(`/api/share/${alice.share}.md`))).status).toBe(200)
  })
})

describe('fail closed', () => {
  it('admit refuses a caller without the flag and a non-boolean flag', () => {
    expect(() => admit({ uid: 'x' })).toThrow('caller without a suspension flag')
    expect(() => admit({ uid: 'x', suspended: null })).toThrow('caller without a suspension flag')
    expect(() => admit({ uid: 'x', suspended: 'no' })).toThrow('caller without a suspension flag')
  })

  it('admit returns the same object for a not suspended caller and throws 403 for a suspended one', () => {
    const caller = { suspended: false }
    expect(admit(caller)).toBe(caller)
    expect(() => admit({ suspended: true })).toThrow(SUSPENDED_MESSAGE)
  })

  it('authenticate returns suspended: false on every path', async () => {
    const alice = await userWith(1, 'alice')
    const withHeader = (token) => new Request(`${APP_URL}/api/drafts?published=false`, { headers: bearer(token) })
    expect((await authenticate(withHeader(alice.xt))).suspended).toBe(false)
    expect((await authenticate(withHeader(alice.xta))).suspended).toBe(false)
    expect((await authenticate(new Request(`${APP_URL}/api/drafts?published=false`, { headers: { cookie: alice.cookie } }))).suspended).toBe(false)
  })
})
