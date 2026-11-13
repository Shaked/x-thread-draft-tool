// @vitest-environment node
import { createHash, randomBytes } from 'node:crypto'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({ putBlob: vi.fn(), deleteBlobUrls: vi.fn(async () => {}) }))

import { route } from '../../server/router.js'
import { resolveAccess } from '../../server/oauth/tokens.js'
import { setMetadataResolverForTests } from '../../server/oauth/clients.js'
import { safeReturnTo } from '../../server/routes/auth.js'
import { apiRequest, setupTestDb, APP_URL } from './helpers/db.js'

const MCP = `${APP_URL}/api/mcp`
const API = `${APP_URL}/api`
const LOCAL_REDIRECT = 'http://localhost:4000/cb'
const FORM = { 'content-type': 'application/x-www-form-urlencoded' }

let db
let alice
let aliceCookie

beforeAll(async () => {
  db = await setupTestDb()
})

beforeEach(async () => {
  await db.reset()
  await db.pg.exec('truncate oauth_clients cascade')
  alice = await db.insertUser({ github_id: 1, login: 'alice' })
  aliceCookie = await db.cookieFor(alice)
  setMetadataResolverForTests(async () => [{ address: '93.184.216.34' }])
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---- helpers ----------------------------------------------------------------------------------

const get = (path, opts) => route(apiRequest(path, { method: 'GET', ...opts }))
const post = (path, body, opts = {}) =>
  route(apiRequest(path, { method: 'POST', body, headers: { ...FORM, ...(opts.headers ?? {}) }, ...opts }))
const postJson = (path, body) =>
  route(apiRequest(path, { method: 'POST', body, headers: { 'content-type': 'application/json' } }))

const sha256Base64url = (value) => createHash('sha256').update(value).digest('base64url')

function pkce() {
  const verifier = randomBytes(48).toString('base64url')
  return { verifier, challenge: sha256Base64url(verifier) }
}

async function registerClient(overrides = {}) {
  const res = await postJson('/api/oauth/register', {
    client_name: 'Test Client',
    redirect_uris: [LOCAL_REDIRECT],
    ...overrides
  })
  expect(res.status).toBe(201)
  return (await res.json()).client_id
}

function authorizeQuery(clientId, { redirectUri = LOCAL_REDIRECT, challenge, state = 'st-1', resource } = {}) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state
  })
  if (resource !== undefined) params.set('resource', resource)
  return params.toString()
}

/** Runs the consent step for a signed-in user and returns the redirect's code and state. */
async function approve(clientId, { cookie = aliceCookie, ...options } = {}) {
  const page = await get(`/api/oauth/authorize?${authorizeQuery(clientId, options)}`, { cookie })
  expect(page.status).toBe(200)
  const requestToken = (await page.text()).match(/name="request" value="([^"]+)"/)[1]
  const res = await post('/api/oauth/authorize', new URLSearchParams({ request: requestToken, decision: 'approve' }).toString(), {
    cookie
  })
  expect(res.status).toBe(302)
  const location = new URL(res.headers.get('location'))
  return { code: location.searchParams.get('code'), state: location.searchParams.get('state'), location }
}

const exchange = (fields) => post('/api/oauth/token', new URLSearchParams(fields).toString())

async function fullPair({ resource = API, clientId, verifier, challenge } = {}) {
  const id = clientId ?? (await registerClient())
  const pair = verifier ? { verifier, challenge } : pkce()
  const { code } = await approve(id, { challenge: pair.challenge, resource })
  const res = await exchange({
    grant_type: 'authorization_code',
    code,
    redirect_uri: LOCAL_REDIRECT,
    client_id: id,
    code_verifier: pair.verifier,
    resource
  })
  expect(res.status).toBe(200)
  return { clientId: id, code, tokens: await res.json(), verifier: pair.verifier, challenge: pair.challenge }
}

const bearer = (token) => ({ authorization: `Bearer ${token}` })

// ---- metadata ---------------------------------------------------------------------------------

describe('metadata documents', () => {
  it('protected resource metadata names the MCP resource and this server, at both paths', async () => {
    for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/api/mcp']) {
      const res = await get(path)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        resource: MCP,
        authorization_servers: [APP_URL],
        scopes_supported: ['drafts'],
        bearer_methods_supported: ['header']
      })
    }
  })

  it('authorization server metadata has absolute endpoints, S256 PKCE and the MCP capability flags', async () => {
    const res = await get('/.well-known/oauth-authorization-server')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      issuer: APP_URL,
      authorization_endpoint: `${APP_URL}/api/oauth/authorize`,
      token_endpoint: `${APP_URL}/api/oauth/token`,
      registration_endpoint: `${APP_URL}/api/oauth/register`,
      revocation_endpoint: `${APP_URL}/api/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['drafts'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true
    })
  })
})

// ---- registration -----------------------------------------------------------------------------

describe('POST /oauth/register', () => {
  it('registers a public client and returns the RFC 7591 fields', async () => {
    const res = await postJson('/api/oauth/register', {
      client_name: '  Claude  ',
      redirect_uris: [LOCAL_REDIRECT, 'https://app.example.com/callback']
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toEqual({
      client_id: expect.stringMatching(/^xtc_[A-Za-z0-9_-]+$/),
      client_name: 'Claude',
      redirect_uris: [LOCAL_REDIRECT, 'https://app.example.com/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code']
    })
  })

  it.each([
    ['a plain http redirect', { redirect_uris: ['http://evil.example/cb'] }],
    ['six redirect URIs', { redirect_uris: Array.from({ length: 6 }, (_, i) => `https://a.example/${i}`) }],
    ['a fragment', { redirect_uris: ['https://a.example/cb#x'] }],
    ['client_secret_basic', { token_endpoint_auth_method: 'client_secret_basic' }],
    ['an empty name', { client_name: '   ' }]
  ])('refuses %s with invalid_client_metadata', async (_label, override) => {
    const res = await postJson('/api/oauth/register', {
      client_name: 'Claude',
      redirect_uris: [LOCAL_REDIRECT],
      ...override
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_client_metadata' })
  })

  it('refuses a body that is not a JSON object', async () => {
    const res = await route(apiRequest('/api/oauth/register', { method: 'POST', body: '[1]', headers: { 'content-type': 'application/json' } }))
    expect(res.status).toBe(400)
  })
})

// ---- client ID metadata documents -------------------------------------------------------------

describe('client ID metadata documents', () => {
  const CLIENT_URL = 'https://app.example.com/oauth/client.json'
  const doc = (overrides = {}) => ({
    client_id: CLIENT_URL,
    client_name: 'Metadata Client',
    redirect_uris: ['https://app.example.com/callback'],
    ...overrides
  })
  const metadataResponse = (body, headers = {}) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json', ...headers }
    })

  function mockFetch(factory) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => factory())
  }

  async function authorizeWith(clientId) {
    return get(`/api/oauth/authorize?${authorizeQuery(clientId, { challenge: pkce().challenge, redirectUri: 'https://app.example.com/callback' })}`, {
      cookie: aliceCookie
    })
  }

  it('accepts a valid document and shows the consent page', async () => {
    const fetchMock = mockFetch(() => metadataResponse(doc()))
    const res = await authorizeWith(CLIENT_URL)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Metadata Client')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const { rows } = await db.pg.query('select kind from oauth_clients where client_id = $1', [CLIENT_URL])
    expect(rows[0].kind).toBe('metadata')
  })

  it('does not fetch a private address', async () => {
    setMetadataResolverForTests(async () => [{ address: '10.0.0.5' }])
    const fetchMock = mockFetch(() => metadataResponse(doc()))
    const res = await authorizeWith(CLIENT_URL)
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses http client IDs without fetching', async () => {
    const fetchMock = mockFetch(() => metadataResponse(doc()))
    const res = await authorizeWith('http://app.example.com/oauth/client.json')
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a document whose client_id differs from the URL', async () => {
    mockFetch(() => metadataResponse(doc({ client_id: 'https://evil.example/client.json' })))
    expect((await authorizeWith(CLIENT_URL)).status).toBe(400)
  })

  it('refuses a document over 10 KB', async () => {
    mockFetch(() => metadataResponse(JSON.stringify({ ...doc(), padding: 'x'.repeat(11 * 1024) })))
    expect((await authorizeWith(CLIENT_URL)).status).toBe(400)
  })

  it('does not follow redirects', async () => {
    mockFetch(() => new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/doc.json' } }))
    expect((await authorizeWith(CLIENT_URL)).status).toBe(400)
  })

  it('caches the document and refetches after 24 hours', async () => {
    const fetchMock = mockFetch(() => metadataResponse(doc()))
    await authorizeWith(CLIENT_URL)
    await authorizeWith(CLIENT_URL)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await db.pg.query(`update oauth_clients set metadata_fetched_at = now() - interval '2 days' where client_id = $1`, [CLIENT_URL])
    await authorizeWith(CLIENT_URL)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('honours Cache-Control: no-store by not caching', async () => {
    const fetchMock = mockFetch(() => metadataResponse(doc(), { 'cache-control': 'no-store' }))
    await authorizeWith(CLIENT_URL)
    await authorizeWith(CLIENT_URL)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

// ---- authorize --------------------------------------------------------------------------------

describe('GET /oauth/authorize', () => {
  it('returns an error page with no Location for an unknown client', async () => {
    const res = await get(`/api/oauth/authorize?${authorizeQuery('xtc_nope', { challenge: pkce().challenge })}`, {
      cookie: aliceCookie
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('location')).toBeNull()
  })

  it('refuses a redirect URI mismatch with an error page and no Location', async () => {
    const clientId = await registerClient()
    const res = await get(
      `/api/oauth/authorize?${authorizeQuery(clientId, { challenge: pkce().challenge, redirectUri: 'http://localhost:5555/evil' })}`,
      { cookie: aliceCookie }
    )
    expect(res.status).toBe(400)
    expect(res.headers.get('location')).toBeNull()
    expect(await res.text()).toContain('did not register')
  })

  it('redirects with error=invalid_request when PKCE is missing', async () => {
    const clientId = await registerClient()
    const params = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: LOCAL_REDIRECT, state: 'abc' })
    const res = await get(`/api/oauth/authorize?${params}`, { cookie: aliceCookie })
    expect(res.status).toBe(302)
    const location = new URL(res.headers.get('location'))
    expect(location.origin + location.pathname).toBe(LOCAL_REDIRECT)
    expect(location.searchParams.get('error')).toBe('invalid_request')
    expect(location.searchParams.get('state')).toBe('abc')
    expect(location.searchParams.get('iss')).toBe(APP_URL)
  })

  it('redirects with error=invalid_target for an unknown resource', async () => {
    const clientId = await registerClient()
    const res = await get(
      `/api/oauth/authorize?${authorizeQuery(clientId, { challenge: pkce().challenge, resource: 'https://evil.example/api' })}`,
      { cookie: aliceCookie }
    )
    expect(res.status).toBe(302)
    expect(new URL(res.headers.get('location')).searchParams.get('error')).toBe('invalid_target')
  })

  it('sends a signed-out user to sign-in with return_to, without the rewrite parameter', async () => {
    const clientId = await registerClient()
    const query = authorizeQuery(clientId, { challenge: pkce().challenge, resource: API })
    const res = await get(`/api/oauth/authorize?${query}&__path=oauth/authorize`)
    expect(res.status).toBe(302)
    const location = new URL(res.headers.get('location'))
    expect(location.pathname).toBe('/api/auth/login')
    expect(location.searchParams.get('return_to')).toBe(`/api/oauth/authorize?${query}`)
  })

  it('shows the consent page with security headers and escaped text', async () => {
    const clientId = await registerClient({ client_name: '<img src=x onerror=alert(1)>' })
    const res = await get(`/api/oauth/authorize?${authorizeQuery(clientId, { challenge: pkce().challenge })}`, {
      cookie: aliceCookie
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const csp = res.headers.get('content-security-policy')
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("form-action 'self' http://localhost:4000")
    const html = await res.text()
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&#60;img')
    expect(html).toContain('localhost:4000')
    expect(html).toContain('not verified')
    expect(html).toContain('read, create, edit, publish, share and delete your drafts')
  })
})

describe('POST /oauth/authorize', () => {
  it('refuses a decision signed for another user with 403', async () => {
    const clientId = await registerClient()
    const page = await get(`/api/oauth/authorize?${authorizeQuery(clientId, { challenge: pkce().challenge })}`, {
      cookie: aliceCookie
    })
    const requestToken = (await page.text()).match(/name="request" value="([^"]+)"/)[1]
    const bob = await db.insertUser({ github_id: 2, login: 'bob' })
    const res = await post('/api/oauth/authorize', new URLSearchParams({ request: requestToken, decision: 'approve' }).toString(), {
      cookie: await db.cookieFor(bob)
    })
    expect(res.status).toBe(403)
    expect(res.headers.get('location')).toBeNull()
  })

  it('refuses a tampered decision', async () => {
    const res = await post('/api/oauth/authorize', new URLSearchParams({ request: 'not.a.jwt', decision: 'approve' }).toString(), {
      cookie: aliceCookie
    })
    expect(res.status).toBe(400)
  })

  it('redirects with error=access_denied when the user denies', async () => {
    const clientId = await registerClient()
    const page = await get(`/api/oauth/authorize?${authorizeQuery(clientId, { challenge: pkce().challenge, state: 'deny-me' })}`, {
      cookie: aliceCookie
    })
    const requestToken = (await page.text()).match(/name="request" value="([^"]+)"/)[1]
    const res = await post('/api/oauth/authorize', new URLSearchParams({ request: requestToken, decision: 'deny' }).toString(), {
      cookie: aliceCookie
    })
    const location = new URL(res.headers.get('location'))
    expect(location.searchParams.get('error')).toBe('access_denied')
    expect(location.searchParams.get('state')).toBe('deny-me')
    expect(location.searchParams.get('code')).toBeNull()
  })

  it('refuses a cross-origin form post', async () => {
    const res = await post('/api/oauth/authorize', 'request=x&decision=approve', {
      cookie: aliceCookie,
      origin: 'https://evil.example'
    })
    expect(res.status).toBe(403)
  })
})

// ---- token ------------------------------------------------------------------------------------

describe('POST /oauth/token', () => {
  it('happy path: authorization code with PKCE gives a pair that works on the REST API', async () => {
    const { tokens, clientId } = await fullPair({ resource: API })
    expect(tokens).toEqual({
      access_token: expect.stringMatching(/^xta_/),
      refresh_token: expect.stringMatching(/^xtr_/),
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'drafts'
    })
    const drafts = await get('/api/drafts?published=false', { headers: bearer(tokens.access_token) })
    expect(drafts.status).toBe(200)
    expect(clientId).toMatch(/^xtc_/)
  })

  it('a token issued for the MCP resource is refused by the REST API', async () => {
    const { tokens } = await fullPair({ resource: MCP })
    expect((await get('/api/drafts?published=false', { headers: bearer(tokens.access_token) })).status).toBe(401)
    expect(await resolveAccess(tokens.access_token, MCP)).toMatchObject({ uid: alice.id, via: 'oauth' })
  })

  it('refuses a wrong PKCE verifier with invalid_grant and keeps the code usable', async () => {
    const clientId = await registerClient()
    const { verifier, challenge } = pkce()
    const { code } = await approve(clientId, { challenge, resource: API })
    const wrong = await exchange({
      grant_type: 'authorization_code', code, redirect_uri: LOCAL_REDIRECT, client_id: clientId,
      code_verifier: pkce().verifier, resource: API
    })
    expect(wrong.status).toBe(400)
    expect(await wrong.json()).toMatchObject({ error: 'invalid_grant' })
    const right = await exchange({
      grant_type: 'authorization_code', code, redirect_uri: LOCAL_REDIRECT, client_id: clientId,
      code_verifier: verifier, resource: API
    })
    expect(right.status).toBe(200)
  })

  it('refuses a different redirect URI with invalid_grant', async () => {
    const clientId = await registerClient({ redirect_uris: [LOCAL_REDIRECT, 'http://localhost:4001/cb'] })
    const { verifier, challenge } = pkce()
    const { code } = await approve(clientId, { challenge, resource: API })
    const res = await exchange({
      grant_type: 'authorization_code', code, redirect_uri: 'http://localhost:4001/cb', client_id: clientId,
      code_verifier: verifier, resource: API
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_grant' })
  })

  it('refuses a resource that differs from the code with invalid_target', async () => {
    const clientId = await registerClient()
    const { verifier, challenge } = pkce()
    const { code } = await approve(clientId, { challenge, resource: API })
    const res = await exchange({
      grant_type: 'authorization_code', code, redirect_uri: LOCAL_REDIRECT, client_id: clientId,
      code_verifier: verifier, resource: MCP
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_target' })
  })

  it('refuses an expired code', async () => {
    const clientId = await registerClient()
    const { verifier, challenge } = pkce()
    const { code } = await approve(clientId, { challenge, resource: API })
    await db.pg.exec(`update oauth_codes set expires_at = now() - interval '1 second'`)
    const res = await exchange({
      grant_type: 'authorization_code', code, redirect_uri: LOCAL_REDIRECT, client_id: clientId,
      code_verifier: verifier, resource: API
    })
    expect(await res.json()).toMatchObject({ error: 'invalid_grant' })
  })

  it('a reused code is refused and revokes the grant and its tokens', async () => {
    const clientId = await registerClient()
    const { verifier, challenge } = pkce()
    const { code } = await approve(clientId, { challenge, resource: API })
    const body = { grant_type: 'authorization_code', code, redirect_uri: LOCAL_REDIRECT, client_id: clientId, code_verifier: verifier, resource: API }
    const first = await exchange(body)
    expect(first.status).toBe(200)
    const tokens = await first.json()

    const reuse = await exchange(body)
    expect(reuse.status).toBe(400)
    expect(await reuse.json()).toMatchObject({ error: 'invalid_grant' })
    expect(await resolveAccess(tokens.access_token, API)).toBeNull()
    expect((await get('/api/drafts?published=false', { headers: bearer(tokens.access_token) })).status).toBe(401)
  })

  it('a redeemed code with a wrong verifier does not revoke the grant', async () => {
    const clientId = await registerClient()
    const { verifier, challenge } = pkce()
    const { code } = await approve(clientId, { challenge, resource: API })
    const first = await exchange({
      grant_type: 'authorization_code', code, redirect_uri: LOCAL_REDIRECT, client_id: clientId,
      code_verifier: verifier, resource: API
    })
    const tokens = await first.json()

    const forged = await exchange({
      grant_type: 'authorization_code', code, redirect_uri: LOCAL_REDIRECT, client_id: clientId,
      code_verifier: pkce().verifier, resource: API
    })
    expect(forged.status).toBe(400)
    expect(await forged.json()).toMatchObject({ error: 'invalid_grant' })
    expect(await resolveAccess(tokens.access_token, API)).toMatchObject({ uid: alice.id, via: 'oauth' })
    expect((await get('/api/drafts?published=false', { headers: bearer(tokens.access_token) })).status).toBe(200)
  })

  it('a redeemed code with a wrong redirect URI does not revoke the grant', async () => {
    const clientId = await registerClient({ redirect_uris: [LOCAL_REDIRECT, 'http://localhost:4001/cb'] })
    const { verifier, challenge } = pkce()
    const { code } = await approve(clientId, { challenge, resource: API })
    const first = await exchange({
      grant_type: 'authorization_code', code, redirect_uri: LOCAL_REDIRECT, client_id: clientId,
      code_verifier: verifier, resource: API
    })
    const tokens = await first.json()

    const forged = await exchange({
      grant_type: 'authorization_code', code, redirect_uri: 'http://localhost:4001/cb', client_id: clientId,
      code_verifier: verifier, resource: API
    })
    expect(forged.status).toBe(400)
    expect(await forged.json()).toMatchObject({ error: 'invalid_grant' })
    expect(await resolveAccess(tokens.access_token, API)).toMatchObject({ uid: alice.id, via: 'oauth' })
  })

  it('refreshes by rotation, and reusing a spent refresh token revokes the grant', async () => {
    const { tokens, clientId } = await fullPair({ resource: API })
    const refreshed = await exchange({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId })
    expect(refreshed.status).toBe(200)
    const next = await refreshed.json()
    expect(next.access_token).not.toBe(tokens.access_token)

    const reuse = await exchange({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId })
    expect(await reuse.json()).toMatchObject({ error: 'invalid_grant' })
    expect(await resolveAccess(next.access_token, API)).toBeNull()
  })

  it('refuses a refresh from another client', async () => {
    const { tokens } = await fullPair({ resource: API })
    const other = await registerClient({ client_name: 'Other' })
    const res = await exchange({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: other })
    expect(await res.json()).toMatchObject({ error: 'invalid_grant' })
  })

  it('reports invalid_request for missing fields and unsupported_grant_type for others', async () => {
    const missing = await exchange({ grant_type: 'authorization_code', code: 'x' })
    expect(await missing.json()).toMatchObject({ error: 'invalid_request' })
    const other = await exchange({ grant_type: 'client_credentials' })
    expect(other.status).toBe(400)
    expect(await other.json()).toMatchObject({ error: 'unsupported_grant_type' })
  })

  it('is exempt from the Origin check (no cookies are used here)', async () => {
    const res = await post('/api/oauth/token', 'grant_type=client_credentials', { origin: 'https://evil.example' })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'unsupported_grant_type' })
  })
})

// ---- transactions and re-approval -------------------------------------------------------------

describe('code exchange is atomic', () => {
  it('a failed token insert rolls back: the code stays unused, the grant stays active, and a retry succeeds', async () => {
    const clientId = await registerClient()
    const { verifier, challenge } = pkce()
    const { code } = await approve(clientId, { challenge, resource: API })
    const body = {
      grant_type: 'authorization_code', code, redirect_uri: LOCAL_REDIRECT, client_id: clientId,
      code_verifier: verifier, resource: API
    }

    const original = db.pg.query.bind(db.pg)
    let injected = false
    vi.spyOn(db.pg, 'query').mockImplementation(async (text, params) => {
      if (!injected && /insert into oauth_tokens/.test(text)) {
        injected = true
        throw new Error('simulated insert failure')
      }
      return original(text, params)
    })
    const failed = await exchange(body)
    expect(failed.status).toBe(500)
    vi.restoreAllMocks()

    const { rows: codes } = await db.pg.query('select used_at from oauth_codes')
    expect(codes[0].used_at).toBeNull()
    const { rows: grants } = await db.pg.query('select revoked_at from oauth_grants')
    expect(grants[0].revoked_at).toBeNull()
    const { rows: tokens } = await db.pg.query('select count(*)::int as n from oauth_tokens')
    expect(tokens[0].n).toBe(0)

    const retry = await exchange(body)
    expect(retry.status).toBe(200)
    expect(await retry.json()).toMatchObject({ access_token: expect.stringMatching(/^xta_/) })
  })
})

describe('re-approving a revoked app', () => {
  it('refuses the old access and refresh tokens once the same app is approved again', async () => {
    const { tokens, clientId } = await fullPair({ resource: API })
    expect((await get('/api/drafts?published=false', { headers: bearer(tokens.access_token) })).status).toBe(200)
    await post('/api/oauth/revoke', new URLSearchParams({ token: tokens.refresh_token }).toString())

    const { verifier, challenge } = pkce()
    const { code } = await approve(clientId, { challenge, resource: API })
    expect(code).toBeTruthy()

    expect(await resolveAccess(tokens.access_token, API)).toBeNull()
    expect((await get('/api/drafts?published=false', { headers: bearer(tokens.access_token) })).status).toBe(401)
    const refresh = await exchange({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId })
    expect(await refresh.json()).toMatchObject({ error: 'invalid_grant' })

    const fresh = await exchange({
      grant_type: 'authorization_code', code, redirect_uri: LOCAL_REDIRECT, client_id: clientId,
      code_verifier: verifier, resource: API
    })
    expect(fresh.status).toBe(200)
    const next = await fresh.json()
    expect((await get('/api/drafts?published=false', { headers: bearer(next.access_token) })).status).toBe(200)
  })

  it('refuses an unused code issued before the revocation', async () => {
    const clientId = await registerClient()
    const { verifier, challenge } = pkce()
    const { code: oldCode } = await approve(clientId, { challenge, resource: API })
    await db.pg.exec('update oauth_grants set revoked_at = now()')

    await approve(clientId, { challenge: pkce().challenge, resource: API })
    const res = await exchange({
      grant_type: 'authorization_code', code: oldCode, redirect_uri: LOCAL_REDIRECT, client_id: clientId,
      code_verifier: verifier, resource: API
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_grant' })
  })
})

// ---- revoke -----------------------------------------------------------------------------------

describe('POST /oauth/revoke', () => {
  it('revokes the grant of a refresh token, and always answers 200', async () => {
    const { tokens, clientId } = await fullPair({ resource: API })
    const res = await post('/api/oauth/revoke', new URLSearchParams({ token: tokens.refresh_token }).toString())
    expect(res.status).toBe(200)
    const refresh = await exchange({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId })
    expect(await refresh.json()).toMatchObject({ error: 'invalid_grant' })
    expect(await resolveAccess(tokens.access_token, API)).toBeNull()
  })

  it('answers 200 for an unknown token', async () => {
    const res = await post('/api/oauth/revoke', new URLSearchParams({ token: 'xtr_unknown' }).toString())
    expect(res.status).toBe(200)
  })
})

// ---- sign-in return path ----------------------------------------------------------------------

describe('GET /api/auth/login return_to', () => {
  it('accepts only the consent endpoint and refuses other destinations', () => {
    expect(safeReturnTo('/api/oauth/authorize?client_id=x')).toBe('/api/oauth/authorize?client_id=x')
    expect(safeReturnTo('https://evil.example')).toBeNull()
    expect(safeReturnTo('//evil.example/api/oauth/authorize?')).toBeNull()
    expect(safeReturnTo('/api/drafts')).toBeNull()
    expect(safeReturnTo('/api/oauth/authorize?x=\nbad')).toBeNull()
  })

  it('stores an accepted return path in a cookie and ignores others', async () => {
    const accepted = await get(`/api/auth/login?return_to=${encodeURIComponent('/api/oauth/authorize?client_id=x')}`)
    expect(accepted.headers.get('set-cookie')).toContain('xt_oauth_return=')
    const refused = await get(`/api/auth/login?return_to=${encodeURIComponent('https://evil.example')}`)
    expect(refused.headers.get('set-cookie') ?? '').not.toContain('xt_oauth_return')
  })
})
