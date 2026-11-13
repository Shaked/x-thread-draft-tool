// @vitest-environment node
// Client profiles for the MCP connector (docs/plans/mcp-clients.md, M1). Each profile runs the
// whole path a real client takes: discovery, client setup, authorize, consent, token, initialize,
// tools/list, a tool call, refresh and a second tool call.
import { createHash, randomBytes } from 'node:crypto'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({ putBlob: vi.fn(), deleteBlobUrls: vi.fn(async () => {}) }))

import { route } from '../../server/router.js'
import { redirectUriAllowed, setMetadataResolverForTests } from '../../server/oauth/clients.js'
import { apiRequest, setupTestDb, APP_URL } from './helpers/db.js'

const MCP = `${APP_URL}/api/mcp`
const API = `${APP_URL}/api`
const FORM = { 'content-type': 'application/x-www-form-urlencoded' }
const CLAUDE_CODE_METADATA = 'https://claude.ai/oauth/claude-code-client-metadata'

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
const exchange = (fields) => post('/api/oauth/token', new URLSearchParams(fields).toString())

const sha256Base64url = (value) => createHash('sha256').update(value).digest('base64url')
function pkce() {
  const verifier = randomBytes(48).toString('base64url')
  return { verifier, challenge: sha256Base64url(verifier) }
}

async function registerClient(overrides) {
  const res = await postJson('/api/oauth/register', overrides)
  expect(res.status).toBe(201)
  return (await res.json()).client_id
}

function authorizeQuery(clientId, { redirectUri, challenge, method = 'S256', resource, state = 'st-1' }) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: method,
    state
  })
  if (resource !== undefined) params.set('resource', resource)
  return params.toString()
}

/** Consent for a signed-in user: returns the code from the redirect. */
async function approve(clientId, options) {
  const page = await get(`/api/oauth/authorize?${authorizeQuery(clientId, options)}`, { cookie: aliceCookie })
  expect(page.status).toBe(200)
  const requestToken = (await page.text()).match(/name="request" value="([^"]+)"/)[1]
  const res = await post('/api/oauth/authorize', new URLSearchParams({ request: requestToken, decision: 'approve' }).toString(), {
    cookie: aliceCookie
  })
  expect(res.status).toBe(302)
  return new URL(res.headers.get('location')).searchParams.get('code')
}

/** A legacy JSON-RPC POST to /api/mcp with the client's protocol version header. */
async function mcp(version, token, method, params = {}) {
  const res = await route(
    new Request(MCP, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': version,
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    })
  )
  expect(res.status).toBe(200)
  return res.json()
}

// ---- client profiles --------------------------------------------------------------------------

// `sendResource` is what the client puts in the authorize and token requests. Codex omits it.
const PROFILES = [
  {
    name: 'claude-web',
    version: '2025-11-25',
    sendResource: true,
    redirect: 'https://claude.ai/api/mcp/auth_callback',
    registration: { client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }
  },
  {
    name: 'claude-code',
    version: '2025-11-25',
    sendResource: true,
    redirect: 'http://localhost:49152/callback',
    metadata: {
      url: CLAUDE_CODE_METADATA,
      doc: {
        client_id: CLAUDE_CODE_METADATA,
        client_name: 'Claude Code',
        redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback']
      }
    }
  },
  {
    name: 'codex',
    version: '2025-06-18',
    sendResource: false,
    redirect: 'http://127.0.0.1:1455/callback',
    registration: { client_name: 'Codex', redirect_uris: ['http://127.0.0.1:1455/callback'] }
  },
  {
    name: 'chatgpt',
    version: '2025-06-18',
    sendResource: true,
    redirect: 'https://chatgpt.com/connector_platform_oauth_redirect',
    registration: {
      client_name: 'ChatGPT',
      redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect']
    }
  }
]

async function clientIdFor(profile) {
  if (profile.metadata) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify(profile.metadata.doc), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    )
    return profile.metadata.url
  }
  return registerClient(profile.registration)
}

describe.each(PROFILES)('client profile: $name', (profile) => {
  it('completes discovery, consent, token, tool calls and refresh', async () => {
    // Discovery: a request without a token gets 401 that names the metadata URL.
    const unauth = await route(
      new Request(MCP, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'mcp-protocol-version': profile.version },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      })
    )
    expect(unauth.status).toBe(401)
    expect(unauth.headers.get('www-authenticate')).toContain('/.well-known/oauth-protected-resource/api/mcp')
    const resourceMeta = await (await get('/.well-known/oauth-protected-resource/api/mcp')).json()
    expect(resourceMeta.resource).toBe(MCP)
    expect((await get('/.well-known/oauth-authorization-server')).status).toBe(200)

    // Client setup, authorize, consent and token exchange.
    const clientId = await clientIdFor(profile)
    const pair = pkce()
    const resource = profile.sendResource ? MCP : undefined
    const code = await approve(clientId, { redirectUri: profile.redirect, challenge: pair.challenge, resource })
    const tokenFields = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: profile.redirect,
      client_id: clientId,
      code_verifier: pair.verifier,
      ...(resource ? { resource } : {})
    }
    const issued = await exchange(tokenFields)
    expect(issued.status).toBe(200)
    const tokens = await issued.json()

    // MCP: initialize, tools/list and one tool call.
    const init = await mcp(profile.version, tokens.access_token, 'initialize', {
      protocolVersion: profile.version,
      capabilities: {},
      clientInfo: { name: profile.name, version: '1' }
    })
    expect(init.result.protocolVersion).toBe(profile.version)
    const tools = await mcp(profile.version, tokens.access_token, 'tools/list')
    expect(tools.result.tools.map((t) => t.name)).toContain('list_drafts')
    const first = await mcp(profile.version, tokens.access_token, 'tools/call', { name: 'list_drafts', arguments: {} })
    expect(first.result.isError).not.toBe(true)

    // Refresh (the token endpoint accepts the refresh token with or without resource), then a call.
    const refreshed = await exchange({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: clientId,
      ...(resource ? { resource } : {})
    })
    expect(refreshed.status).toBe(200)
    const fresh = await refreshed.json()
    const second = await mcp(profile.version, fresh.access_token, 'tools/call', { name: 'list_drafts', arguments: {} })
    expect(second.result.isError).not.toBe(true)
  })
})

// ---- redirect URI matching (D-1) --------------------------------------------------------------

describe('redirectUriAllowed (RFC 8252 section 7.3)', () => {
  it('matches exactly, and loopback URIs ignoring the port only', () => {
    const registered = ['http://localhost/callback', 'https://app.example.com/cb']
    expect(redirectUriAllowed(registered, 'https://app.example.com/cb')).toBe(true)
    expect(redirectUriAllowed(registered, 'http://localhost/callback')).toBe(true)
    expect(redirectUriAllowed(registered, 'http://localhost:49152/callback')).toBe(true)
    expect(redirectUriAllowed(registered, 'http://127.0.0.1:49152/callback')).toBe(false)
  })

  it('refuses the negative cases from the plan', () => {
    const registered = ['http://localhost/callback', 'https://app.example.com/cb']
    expect(redirectUriAllowed(registered, 'http://localhost:1/other')).toBe(false)
    expect(redirectUriAllowed(registered, 'http://localhost.evil.test:1/callback')).toBe(false)
    expect(redirectUriAllowed(registered, 'https://app.example.com:8443/cb')).toBe(false)
    expect(redirectUriAllowed(['https://app.example.com/cb'], 'https://app.example.com:8443/cb')).toBe(false)
    expect(redirectUriAllowed(['http://localhost/callback'], 'http://localhost:1/callback?x=1')).toBe(false)
    expect(redirectUriAllowed(['http://localhost/callback'], 'http://evil.example:1/callback')).toBe(false)
  })
})

describe('authorize and token checks', () => {
  it('refuses a loopback redirect whose path differs, and a non-loopback port change', async () => {
    const clientId = await registerClient({ client_name: 'Loop', redirect_uris: ['http://localhost/callback'] })
    const challenge = pkce().challenge
    const other = await get(`/api/oauth/authorize?${authorizeQuery(clientId, { redirectUri: 'http://localhost:1/other', challenge })}`, {
      cookie: aliceCookie
    })
    expect(other.status).toBe(400)
    const evil = await get(
      `/api/oauth/authorize?${authorizeQuery(clientId, { redirectUri: 'http://localhost.evil.test:1/callback', challenge })}`,
      { cookie: aliceCookie }
    )
    expect(evil.status).toBe(400)
  })

  it('refuses an https redirect with another port', async () => {
    const clientId = await registerClient({ client_name: 'Web', redirect_uris: ['https://app.example.com/cb'] })
    const res = await get(
      `/api/oauth/authorize?${authorizeQuery(clientId, { redirectUri: 'https://app.example.com:8443/cb', challenge: pkce().challenge })}`,
      { cookie: aliceCookie }
    )
    expect(res.status).toBe(400)
  })

  it('refuses a plain PKCE method', async () => {
    const clientId = await registerClient({ client_name: 'Plain', redirect_uris: ['http://localhost/callback'] })
    const res = await get(
      `/api/oauth/authorize?${authorizeQuery(clientId, { redirectUri: 'http://localhost:9/callback', challenge: 'abc', method: 'plain' })}`,
      { cookie: aliceCookie }
    )
    expect(res.status).toBe(302)
    expect(new URL(res.headers.get('location')).searchParams.get('error')).toBe('invalid_request')
  })

  it('refuses a present but wrong resource with invalid_target', async () => {
    const clientId = await registerClient({ client_name: 'Res', redirect_uris: ['http://localhost/callback'] })
    const pair = pkce()
    const code = await approve(clientId, { redirectUri: 'http://localhost:9/callback', challenge: pair.challenge, resource: API })
    const res = await exchange({
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'http://localhost:9/callback',
      client_id: clientId,
      code_verifier: pair.verifier,
      resource: 'https://evil.example/api'
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_target' })
  })

  it('refuses a code exchange whose redirect_uri has another port than the authorize request', async () => {
    const clientId = await registerClient({ client_name: 'Port', redirect_uris: ['http://localhost/callback'] })
    const pair = pkce()
    const code = await approve(clientId, { redirectUri: 'http://localhost:9/callback', challenge: pair.challenge, resource: API })
    const res = await exchange({
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'http://localhost:10/callback',
      client_id: clientId,
      code_verifier: pair.verifier,
      resource: API
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_grant' })
  })

  it('a code exchange without resource succeeds with the code\'s resource (D-2)', async () => {
    const clientId = await registerClient({ client_name: 'NoRes', redirect_uris: ['http://localhost/callback'] })
    const pair = pkce()
    const code = await approve(clientId, { redirectUri: 'http://localhost:9/callback', challenge: pair.challenge })
    const res = await exchange({
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'http://localhost:9/callback',
      client_id: clientId,
      code_verifier: pair.verifier
    })
    expect(res.status).toBe(200)
    const tokens = await res.json()
    const call = await mcp('2025-06-18', tokens.access_token, 'tools/call', { name: 'list_drafts', arguments: {} })
    expect(call.result.isError).not.toBe(true)
  })
})

// ---- legacy clients without the version header (M2) -------------------------------------------

describe('codex without the version header (M2)', () => {
  it('a POST with no MCP-Protocol-Version header is served as 2025-03-26 after a token is issued', async () => {
    const clientId = await registerClient({ client_name: 'Codex', redirect_uris: ['http://127.0.0.1:1455/callback'] })
    const pair = pkce()
    const code = await approve(clientId, { redirectUri: 'http://127.0.0.1:1455/callback', challenge: pair.challenge })
    const issued = await exchange({
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'http://127.0.0.1:1455/callback',
      client_id: clientId,
      code_verifier: pair.verifier
    })
    expect(issued.status).toBe(200)
    const { access_token } = await issued.json()
    const res = await route(
      new Request(MCP, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${access_token}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      })
    )
    expect(res.status).toBe(200)
    expect((await res.json()).result.tools.map((t) => t.name)).toContain('list_drafts')
  })
})
