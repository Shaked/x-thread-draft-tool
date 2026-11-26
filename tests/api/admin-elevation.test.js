// @vitest-environment node
// Admin is pure identity: any token for the MCP resource whose user is the owner lists and runs the admin tools.
// There is no elevation: no box, no pairing code, no notice, no time limit, and approval never touches admin.
import { createHash, randomBytes } from 'node:crypto'
import { SignJWT } from 'jose'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({ putBlob: vi.fn(), deleteBlobUrls: vi.fn(async () => {}) }))

import { route } from '../../server/router.js'
import { secretKey } from '../../server/session.js'
import { setMetadataResolverForTests } from '../../server/oauth/clients.js'
import { resolveAccess } from '../../server/oauth/tokens.js'
import { APP_URL, apiRequest, setupTestDb } from './helpers/db.js'

const MCP = `${APP_URL}/api/mcp`
const API = `${APP_URL}/api`
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback'
const EVIL = 'https://evil.example/cb'
const LOOPBACK = 'http://localhost/callback'
const ADMIN_GITHUB_ID = 960015
const LEGACY = '2025-11-25'
const FORM = { 'content-type': 'application/x-www-form-urlencoded' }

let db
let admin
let alice

beforeAll(async () => {
  db = await setupTestDb()
})

beforeEach(async () => {
  await db.reset()
  await db.pg.exec('delete from oauth_clients')
  await db.pg.exec('delete from admin_audit')
  admin = await db.insertUser({ github_id: ADMIN_GITHUB_ID, login: 'Shaked' })
  alice = await db.insertUser({ github_id: 1, login: 'alice' })
  setMetadataResolverForTests(async () => [{ address: '93.184.216.34' }])
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete process.env.ADMIN_DISABLED
})

// ---- helpers ----------------------------------------------------------------------------------

const sha256Base64url = (value) => createHash('sha256').update(value).digest('base64url')

function pkce() {
  const verifier = randomBytes(48).toString('base64url')
  return { verifier, challenge: sha256Base64url(verifier) }
}

/** A browser session cookie for the user, issued `ageSeconds` ago (the consent check reads `iat`). */
async function cookieFor(user, ageSeconds = 0, gh = String(user.github_id)) {
  const now = Math.floor(Date.now() / 1000)
  const token = await new SignJWT({
    uid: user.id,
    gh,
    login: user.login,
    jti: randomBytes(24).toString('base64url')
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now - ageSeconds)
    .setExpirationTime(now + 3600)
    .sign(secretKey())
  return `xt_session=${token}`
}

async function registerClient(redirectUri) {
  const res = await route(
    apiRequest('/api/oauth/register', {
      method: 'POST',
      body: { client_name: 'Test App', redirect_uris: [redirectUri] },
      headers: { 'content-type': 'application/json' }
    })
  )
  expect(res.status).toBe(201)
  return (await res.json()).client_id
}

/** The consent address for a client. `resource` is sent only when given (absent means the MCP server). */
function authorizePath(clientId, { redirectUri, challenge, state = 'st-1', resource } = {}) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state
  })
  if (resource !== undefined) params.set('resource', resource)
  return `/api/oauth/authorize?${params}`
}

const getPage = (path, cookie) => route(apiRequest(path, { method: 'GET', cookie }))

/** Reads the signed decision the consent page carries into its form. */
function decisionOf(html) {
  return html.match(/name="request" value="([^"]+)"/)[1]
}

/** Posts the consent form the way the browser does: fetch the page, then approve with its decision. */
async function approve(path, cookie) {
  const page = await getPage(path, cookie)
  expect(page.status).toBe(200)
  const form = new URLSearchParams({ request: decisionOf(await page.text()), decision: 'approve' })
  return route(apiRequest('/api/oauth/authorize', { method: 'POST', body: form.toString(), headers: FORM, cookie }))
}


async function grantOf(user, resource = MCP) {
  const { rows } = await db.pg.query('select id, admin_until from oauth_grants where user_id = $1 and resource = $2', [user.id, resource])
  return rows[0]
}

/** Exchanges an authorization code from a redirect for a token pair. */
async function exchange(link, clientId, redirectUri, verifier) {
  const code = link.searchParams.get('code')
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier
  })
  const res = await route(apiRequest('/api/oauth/token', { method: 'POST', body: body.toString(), headers: FORM }))
  expect(res.status).toBe(200)
  return res.json()
}

/** The tool names an MCP access token lists (legacy protocol header, one JSON-RPC call). */
async function toolNames(token) {
  const res = await route(
    new Request(MCP, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
        'mcp-protocol-version': LEGACY
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    })
  )
  return JSON.parse(await res.text()).result.tools.map((tool) => tool.name)
}

/** One JSON-RPC call on the legacy protocol with the token. Returns the parsed answer. */
async function rpcOn(token, method, params = {}) {
  const res = await route(
    new Request(MCP, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
        'mcp-protocol-version': LEGACY
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    })
  )
  return JSON.parse(await res.text())
}

const callOn = (token, name, args) => rpcOn(token, 'tools/call', { name, arguments: args })



/** The raw Response of a tools/list call, for the status code. */
const rpcRaw = (token) =>
  route(
    new Request(MCP, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
        'mcp-protocol-version': LEGACY
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    })
  )

// ---- The consent page ---------------------------------------------------------------------------

describe('the consent page tells the admin, and only the admin, that the app gets admin tools', () => {
  const noAdminText = (html) => {
    expect(html).not.toMatch(/admin/i)
    expect(html).not.toContain('name="admin"')
  }

  it('shows the admin line to the owner on the MCP resource, any return address, any sign-in age, with the host in bold', async () => {
    for (const [redirect, age] of [[CLAUDE, 0], [CLAUDE, 86_400], [EVIL, 0], [LOOPBACK, 0]]) {
      const clientId = await registerClient(redirect)
      const res = await getPage(authorizePath(clientId, { redirectUri: redirect, challenge: pkce().challenge }), await cookieFor(admin, age))
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain('You are the admin.')
      expect(html).toContain(`<strong>${new URL(redirect).host}</strong> will get the admin tools`)
      expect(html).not.toContain('name="admin"')
    }
  })

  it('shows nothing to a normal user, nor for the REST resource, nor with ADMIN_DISABLED=1', async () => {
    const clientId = await registerClient(CLAUDE)
    const path = authorizePath(clientId, { redirectUri: CLAUDE, challenge: pkce().challenge })
    noAdminText(await (await getPage(path, await cookieFor(alice))).text())
    const restPath = authorizePath(clientId, { redirectUri: CLAUDE, challenge: pkce().challenge, resource: API })
    noAdminText(await (await getPage(restPath, await cookieFor(admin))).text())
    process.env.ADMIN_DISABLED = '1'
    noAdminText(await (await getPage(path, await cookieFor(admin))).text())
  })

  // Audit #276, R4: the owner sees which site the app belongs to, and a warning when the code would go elsewhere.
  /** A metadata-document client (client_id is an https URL), as cached after a fetch: no network. */
  async function metadataClient(clientId, redirectUri) {
    await db.pg.query(
      "insert into oauth_clients (client_id, kind, client_name, redirect_uris, metadata_fetched_at) values ($1, 'metadata', 'Claude', $2, now())",
      [clientId, [redirectUri]]
    )
    return clientId
  }
  const adminPage = async (clientId, redirect, user = admin) =>
    (await getPage(authorizePath(clientId, { redirectUri: redirect, challenge: pkce().challenge }), await cookieFor(user))).text()
  const MISMATCH = "The return address is not on the app's own site."

  it('names the app site of a metadata client and warns only when the return address is elsewhere', async () => {
    const own = await adminPage(await metadataClient('https://claude.ai/oauth/client.json', CLAUDE), CLAUDE)
    expect(own).toContain("The app's own site is <strong>claude.ai</strong>.")
    expect(own).not.toContain(MISMATCH)

    const sub = await adminPage(await metadataClient('https://example.com/client.json', 'https://app.example.com/cb'), 'https://app.example.com/cb')
    expect(sub).not.toContain(MISMATCH)

    const local = await adminPage(await metadataClient('https://cli.example/client.json', LOOPBACK), LOOPBACK)
    expect(local).not.toContain(MISMATCH)

    for (const [clientId, redirect] of [
      ['https://claude.ai.evil.example/client.json', EVIL],
      ['https://evil.example/client.json', 'https://notevil.example/cb'],
      ['https://app.example.com/client.json', 'https://example.com/cb']
    ]) {
      const html = await adminPage(await metadataClient(clientId, redirect), redirect)
      expect(html).toContain(`The app's own site is <strong>${new URL(clientId).host}</strong>.`)
      expect(html).toContain(`<strong>${MISMATCH}</strong>`)
    }
  })

  it('says a registered client names no site, and shows no site line to a normal user', async () => {
    const registered = await adminPage(await registerClient(EVIL), EVIL)
    expect(registered).toContain('This app did not say which site it belongs to.')
    expect(registered).not.toContain(MISMATCH)
    const userPage = await adminPage(await metadataClient('https://evil.example/client.json', 'https://other.example/cb'), 'https://other.example/cb', alice)
    expect(userPage).not.toContain("app's own site")
    expect(userPage).not.toContain(MISMATCH)
  })

  it('escapes the state in the consent link', async () => {
    const clientId = await registerClient(CLAUDE)
    const html = await (
      await getPage(authorizePath(clientId, { redirectUri: CLAUDE, challenge: pkce().challenge, state: '"<>&' }), await cookieFor(admin))
    ).text()
    expect(html).not.toContain('"<>&')
    expect(html).not.toContain('<>')
  })
})

// ---- The approval ---------------------------------------------------------------------------------

/** Approves for the owner on the MCP resource and exchanges the code: the connection's token. */
async function ownerApp(redirect = CLAUDE) {
  const clientId = await registerClient(redirect)
  const { verifier, challenge } = pkce()
  const path = authorizePath(clientId, { redirectUri: redirect, challenge })
  const res = await approve(path, await cookieFor(admin))
  expect(res.status).toBe(302)
  const tokens = await exchange(new URL(res.headers.get('location')), clientId, redirect, verifier)
  return { token: tokens.access_token, clientId, path, res, verifier }
}

const adminNames = async (token) => (await toolNames(token)).filter((name) => name.startsWith('admin_'))

describe('admin follows identity, with no special step', () => {
  it('the owner on the MCP resource: a normal approval lists all 14 admin tools; admin_status and admin_stats work', async () => {
    const { token, res } = await ownerApp()
    const location = new URL(res.headers.get('location'))
    expect(location.origin + location.pathname).toBe(CLAUDE)
    expect(location.searchParams.get('state')).toBe('st-1')

    expect(await adminNames(token)).toHaveLength(14)
    expect(await adminNames(token)).toContain('admin_status')
    const listed = await rpcOn(token, 'tools/list', {})
    expect(listed.result.cacheScope).toBe('private')

    const status = await callOn(token, 'admin_status', {})
    expect(status.result.isError).toBe(false)
    expect(status.result.structuredContent).toMatchObject({ admin: true, login: 'Shaked', github_id: String(ADMIN_GITHUB_ID) })
    expect(status.result.structuredContent).not.toHaveProperty('admin_until')
    expect((await callOn(token, 'admin_stats', {})).result.isError).toBe(false)
  })

  it('a normal user gets no admin tools', async () => {
    const clientId = await registerClient(CLAUDE)
    const { verifier, challenge } = pkce()
    const res = await approve(authorizePath(clientId, { redirectUri: CLAUDE, challenge }), await cookieFor(alice))
    expect(res.status).toBe(302)
    const tokens = await exchange(new URL(res.headers.get('location')), clientId, CLAUDE, verifier)
    expect(await adminNames(tokens.access_token)).toEqual([])
    expect((await callOn(tokens.access_token, 'admin_status', {})).error.message).toMatch(/unknown tool/)
  })

  it('the owner on the REST resource gets no admin tools', async () => {
    const clientId = await registerClient(CLAUDE)
    const { verifier, challenge } = pkce()
    const res = await approve(authorizePath(clientId, { redirectUri: CLAUDE, challenge, resource: API }), await cookieFor(admin))
    expect(res.status).toBe(302)
    const tokens = await exchange(new URL(res.headers.get('location')), clientId, CLAUDE, verifier)
    expect(await resolveAccess(tokens.access_token, API)).toMatchObject({ admin: false })
    expect(await resolveAccess(tokens.access_token, MCP)).toBeNull()
  })

  it('ADMIN_DISABLED=1 lists no admin tool and an admin tool call is an unknown-tool error', async () => {
    const { token } = await ownerApp()
    expect(await adminNames(token)).toHaveLength(14)
    process.env.ADMIN_DISABLED = '1'
    expect(await adminNames(token)).toEqual([])
    expect((await callOn(token, 'admin_status', {})).error.message).toMatch(/unknown tool/)
  })

  it('approval never sets admin_until, for the owner or anyone', async () => {
    await ownerApp()
    expect((await grantOf(admin)).admin_until).toBeNull()
    const clientId = await registerClient(CLAUDE)
    expect((await approve(authorizePath(clientId, { redirectUri: CLAUDE, challenge: pkce().challenge }), await cookieFor(alice))).status).toBe(302)
    expect((await grantOf(alice)).admin_until).toBeNull()
    expect((await db.pg.query('select count(*)::int as n from admin_audit')).rows[0].n).toBe(0)
  })

  it('a revoked grant is rejected with 401', async () => {
    const { token } = await ownerApp()
    expect(await adminNames(token)).toHaveLength(14)
    const grant = await grantOf(admin)
    const res = await route(apiRequest(`/api/grants/${grant.id}`, { method: 'DELETE', cookie: await cookieFor(admin) }))
    expect(res.status).toBeLessThan(300)
    expect((await rpcRaw(token)).status).toBe(401)
  })

  it('a new approval of a revoked grant kills the tokens issued before the revoke', async () => {
    const { token, path } = await ownerApp()
    const grant = await grantOf(admin)
    await route(apiRequest(`/api/grants/${grant.id}`, { method: 'DELETE', cookie: await cookieFor(admin) }))
    expect(await resolveAccess(token, MCP)).toBeNull()
    expect((await approve(path, await cookieFor(admin))).status).toBe(302)
    expect(await resolveAccess(token, MCP)).toBeNull()
  })

  it('a session cookie that claims the owner id, for a normal user, gets no admin', async () => {
    const clientId = await registerClient(CLAUDE)
    const { verifier, challenge } = pkce()
    const path = authorizePath(clientId, { redirectUri: CLAUDE, challenge })
    const cookie = await cookieFor(alice, 0, String(ADMIN_GITHUB_ID))
    const res = await approve(path, cookie)
    expect(res.status).toBe(302)
    const tokens = await exchange(new URL(res.headers.get('location')), clientId, CLAUDE, verifier)
    expect(await adminNames(tokens.access_token)).toEqual([])
    expect((await grantOf(alice)).admin_until).toBeNull()
  })
})

// ---- A device grant never elevates (plan item 8) ----------------------------------------------

describe('a device grant never carries admin columns', () => {
  it('stores no admin columns, even for the owner', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input) => {
        const url = String(input)
        if (url === 'https://github.com/login/device/code') {
          return Response.json({
            device_code: 'device-123',
            user_code: 'ABCD-1234',
            verification_uri: 'https://github.com/login/device',
            interval: 5,
            expires_in: 900
          })
        }
        if (url === 'https://github.com/login/oauth/access_token') return Response.json({ access_token: 'gho_test', token_type: 'bearer' })
        if (url === 'https://api.github.com/user') {
          return Response.json({ id: ADMIN_GITHUB_ID, login: 'Shaked', name: 'Shaked', avatar_url: null })
        }
        throw new Error(`unexpected fetch ${url}`)
      })
    )
    await route(apiRequest('/api/auth/device/start', { method: 'POST', body: {} }))
    const res = await route(apiRequest('/api/auth/device/poll', { method: 'POST', body: { device_code: 'device-123', name: 'claude' } }))
    expect(res.status).toBe(201)
    const { rows } = await db.pg.query(
      "select admin_until from oauth_grants where client_id = 'device:claude'"
    )
    expect(rows).toEqual([{ admin_until: null }])
  })
})

