// @vitest-environment node
// Plan M11, the client contract suite. A spec-following mock client walks the path a real client
// takes, and uses only what the server advertises: the 401 challenge, protected-resource metadata,
// authorization-server metadata, registration (or a client metadata document), authorize with PKCE,
// consent, token, MCP calls and refresh rotation. Real route(), real OAuth code, real SQL (PGlite).
// No client binary, no account, no person, no LLM. A fetch guard fails on any outbound request other
// than the one mocked client metadata document, so no network and no tokens are used.
import { createHash, randomBytes } from 'node:crypto'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({ putBlob: vi.fn(), deleteBlobUrls: vi.fn(async () => {}) }))

import { route } from '../../server/router.js'
import { setMetadataResolverForTests } from '../../server/oauth/clients.js'
import { apiRequest, setupTestDb, APP_URL } from './helpers/db.js'

const MCP = `${APP_URL}/api/mcp`
const REST = `${APP_URL}/api`
const FORM = { 'content-type': 'application/x-www-form-urlencoded' }
const PROTOCOL = '2025-11-25'
const CLIENT_METADATA_URL = 'https://client.example.test/oauth/cli-metadata'
const LOOPBACK_PORT = 49152
const CLIENT_METADATA = {
  client_id: CLIENT_METADATA_URL,
  client_name: 'Contract client',
  redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback']
}

let db
let alice
let aliceCookie

beforeAll(async () => {
  db = await setupTestDb()
})

beforeEach(async () => {
  await db.reset()
  await db.pg.exec('delete from oauth_clients')
  alice = await db.insertUser({ github_id: 1, login: 'alice' })
  aliceCookie = await db.cookieFor(alice)
  setMetadataResolverForTests(async () => [{ address: '93.184.216.34' }])
  // The only outbound request a client makes is the metadata document. Anything else fails the test.
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const href = input?.url ?? String(input)
    if (href === CLIENT_METADATA_URL) {
      return new Response(JSON.stringify(CLIENT_METADATA), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    throw new Error(`outbound request blocked by the contract suite: ${href}`)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---- the mock client --------------------------------------------------------------------------

/** A request to a URL the server advertised (absolute, under APP_URL), keeping its path and query. */
const at = (url, init = {}) => {
  const target = new URL(url)
  return apiRequest(`${target.pathname}${target.search}`, init)
}

/** The same loopback URI with the port a native client listens on (RFC 8252 section 7.3). */
const withPort = (uri, port) => {
  const url = new URL(uri)
  url.port = String(port)
  return url.toString()
}

const sha256 = (value) => createHash('sha256').update(value).digest('base64url')
function pkce() {
  const verifier = randomBytes(48).toString('base64url')
  return { verifier, challenge: sha256(verifier) }
}

async function bodyJson(res) {
  return JSON.parse(await res.text())
}

/** Discovery the way the spec describes it: challenge, then protected-resource metadata, then the AS. */
async function discover() {
  const challenge = await route(
    apiRequest('/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'mcp-protocol-version': PROTOCOL },
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list' }
    })
  )
  expect(challenge.status).toBe(401)
  const header = challenge.headers.get('www-authenticate')
  const resourceMetadataUrl = header.match(/resource_metadata="([^"]+)"/)?.[1]
  expect(resourceMetadataUrl).toBeTruthy()
  expect(header).toMatch(/scope="drafts"/)

  const resource = await bodyJson(await route(at(resourceMetadataUrl)))
  expect(resource.resource).toBe(MCP)
  expect(resource.authorization_servers).toHaveLength(1)

  const as = await bodyJson(await route(apiRequest('/.well-known/oauth-authorization-server')))
  expect(as.issuer).toBe(resource.authorization_servers[0])
  expect(as.code_challenge_methods_supported).toContain('S256')
  expect(as.token_endpoint_auth_methods_supported).toContain('none')
  expect(as.client_id_metadata_document_supported).toBe(true)
  expect(as.authorization_response_iss_parameter_supported).toBe(true)
  for (const key of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint']) {
    expect(new URL(as[key]).origin).toBe(as.issuer)
  }
  return as
}

async function register(as, redirectUris) {
  const res = await route(
    apiRequest(new URL(as.registration_endpoint).pathname, {
      method: 'POST',
      body: { client_name: 'Contract client', redirect_uris: redirectUris },
      headers: { 'content-type': 'application/json' }
    })
  )
  expect(res.status).toBe(201)
  return (await bodyJson(res)).client_id
}

/** Authorize, consent (the signed-in user approves), and return the redirect the client receives. */
async function authorize(as, { clientId, redirectUri, challenge, state = 'st-1' }) {
  const url = new URL(as.authorization_endpoint)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    resource: MCP
  }).toString()
  const page = await route(at(url.toString(), { cookie: aliceCookie }))
  expect(page.status).toBe(200)
  const requestToken = (await page.text()).match(/name="request" value="([^"]+)"/)?.[1]
  expect(requestToken).toBeTruthy()
  const res = await route(
    apiRequest('/api/oauth/authorize', {
      method: 'POST',
      cookie: aliceCookie,
      headers: FORM,
      body: new URLSearchParams({ request: requestToken, decision: 'approve' }).toString()
    })
  )
  expect(res.status).toBe(302)
  return new URL(res.headers.get('location'))
}

async function tokenRequest(as, fields) {
  return route(
    apiRequest(new URL(as.token_endpoint).pathname, {
      method: 'POST',
      headers: FORM,
      body: new URLSearchParams(fields).toString()
    })
  )
}

async function mcp(token, method, params = {}, id = 1) {
  return route(
    new Request(MCP, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': PROTOCOL,
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
    })
  )
}

/** Discovery, registration, authorize, consent and the code exchange, with the checks a client relies on. */
async function signIn({ redirectUri, clientId }) {
  const as = await discover()
  const pair = pkce()
  const loopback = redirectUri.startsWith('http://localhost') || redirectUri.startsWith('http://127.0.0.1')
  const sentRedirect = loopback ? withPort(redirectUri, LOOPBACK_PORT) : redirectUri
  const id = clientId ?? (await register(as, [redirectUri]))

  const back = await authorize(as, { clientId: id, redirectUri: sentRedirect, challenge: pair.challenge })
  // The redirect keeps the state, carries the issuer (RFC 9207), and goes to the exact loopback port sent.
  expect(back.searchParams.get('state')).toBe('st-1')
  expect(back.searchParams.get('iss')).toBe(as.issuer)
  if (loopback) expect(back.port).toBe(String(LOOPBACK_PORT))
  expect(back.origin + back.pathname).toBe(sentRedirect.split('?')[0])

  const issued = await tokenRequest(as, {
    grant_type: 'authorization_code',
    code: back.searchParams.get('code'),
    redirect_uri: sentRedirect,
    client_id: id,
    code_verifier: pair.verifier,
    resource: MCP
  })
  expect(issued.status).toBe(200)
  expect(issued.headers.get('cache-control')).toBe('no-store')
  expect(issued.headers.get('content-type')).toMatch(/application\/json/)
  const tokens = await bodyJson(issued)
  expect(tokens.token_type).toBe('Bearer')
  expect(tokens.expires_in).toBeGreaterThan(0)
  expect(typeof tokens.access_token).toBe('string')
  expect(typeof tokens.refresh_token).toBe('string')
  return { as, clientId: id, tokens }
}

// ---- the contract -----------------------------------------------------------------------------

describe.each([
  { name: 'DCR loopback client (Codex style)', redirectUri: 'http://127.0.0.1/callback' },
  { name: 'DCR https client (claude.ai style)', redirectUri: 'https://claude.ai/api/mcp/auth_callback' }
])('contract: $name', ({ redirectUri }) => {
  it('discovers, signs in, calls MCP, refreshes, and refuses a replayed refresh token', async () => {
    const { tokens, clientId, as } = await signIn({ redirectUri })

    // MCP: initialize, then the notification (no response body, 202), then tools/list and a call.
    const init = await bodyJson(
      await mcp(tokens.access_token, 'initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'c', version: '1' } })
    )
    expect(init.result.protocolVersion).toBe(PROTOCOL)
    const notified = await route(
      new Request(MCP, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'mcp-protocol-version': PROTOCOL, authorization: `Bearer ${tokens.access_token}` },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
      })
    )
    expect(notified.status).toBe(202)
    const listed = await bodyJson(await mcp(tokens.access_token, 'tools/list'))
    expect(listed.result.tools.map((tool) => tool.name)).toContain('list_drafts')
    const call = await bodyJson(await mcp(tokens.access_token, 'tools/call', { name: 'list_drafts', arguments: {} }))
    expect(call.result.isError).not.toBe(true)

    // Refresh rotates the pair. The old refresh token is then spent: replaying it is invalid_grant,
    // which revokes the grant, so the newest access token is refused too.
    const rotated = await tokenRequest(as, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId })
    expect(rotated.status).toBe(200)
    const fresh = await bodyJson(rotated)
    expect(fresh.refresh_token).not.toBe(tokens.refresh_token)
    const replay = await tokenRequest(as, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId })
    expect(replay.status).toBe(400)
    expect(replay.headers.get('cache-control')).toBe('no-store')
    expect(await bodyJson(replay)).toEqual({ error: 'invalid_grant', error_description: expect.any(String) })
    const afterRevoke = await mcp(fresh.access_token, 'tools/list')
    expect(afterRevoke.status).toBe(401)
    expect(afterRevoke.headers.get('www-authenticate')).toMatch(/resource_metadata=/)
  })

  it('refuses a refresh with another resource, and that refusal does not spend the token', async () => {
    const { tokens, clientId, as } = await signIn({ redirectUri })
    const wrong = await tokenRequest(as, {
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: clientId,
      resource: REST
    })
    expect(wrong.status).toBe(400)
    expect(await bodyJson(wrong)).toEqual({ error: 'invalid_target', error_description: expect.any(String) })

    const retry = await tokenRequest(as, {
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: clientId,
      resource: MCP
    })
    expect(retry.status).toBe(200)
  })

  it('a bad code is a JSON token error with no-store', async () => {
    const as = await discover()
    const id = await register(as, [redirectUri])
    const res = await tokenRequest(as, {
      grant_type: 'authorization_code',
      code: 'not-a-real-code',
      redirect_uri: redirectUri,
      client_id: id,
      code_verifier: pkce().verifier,
      resource: MCP
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await bodyJson(res)).toEqual({ error: 'invalid_grant', error_description: expect.any(String) })
  })
})

describe('contract: metadata-document client (Claude Code style)', () => {
  it('signs in with its client metadata document and a loopback redirect on any port', async () => {
    const { tokens } = await signIn({ redirectUri: 'http://localhost/callback', clientId: CLIENT_METADATA_URL })
    const call = await bodyJson(await mcp(tokens.access_token, 'tools/call', { name: 'list_drafts', arguments: {} }))
    expect(call.result.isError).not.toBe(true)
  })
})

describe('contract: tool schemas', () => {
  it('every tool input schema compiles in strict mode', async () => {
    const { tokens } = await signIn({ redirectUri: 'http://127.0.0.1/callback' })
    const listed = await bodyJson(await mcp(tokens.access_token, 'tools/list'))
    const ajv = addFormats(new Ajv({ strict: true, allErrors: true }))
    expect(listed.result.tools.length).toBeGreaterThan(0)
    for (const tool of listed.result.tools) {
      expect(tool.inputSchema, tool.name).toBeTruthy()
      expect(() => ajv.compile(tool.inputSchema), tool.name).not.toThrow()
    }
  })
})
