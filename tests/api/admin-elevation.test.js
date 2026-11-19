// @vitest-environment node
// Admin follows identity: the owner's approval on the MCP connection gives admin tools for 24 hours, whatever the age of the sign-in.
// There is no box, no pairing code and no pending state.
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

const noElevation = (grant) => expect(grant.admin_until).toBeNull()

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

// ---- The admin notice ---------------------------------------------------------------------------

describe('the admin notice is shown to the owner and to nobody else', () => {
  it('shows the notice to the owner on a fresh sign-in on the MCP resource, with no box', async () => {
    const clientId = await registerClient(CLAUDE)
    const res = await getPage(authorizePath(clientId, { redirectUri: CLAUDE, challenge: pkce().challenge }), await cookieFor(admin))
    const html = await res.text()
    expect(res.status).toBe(200)
    expect(html).toContain('Approving gives')
    expect(html).toContain('<strong>claude.ai</strong>')
    expect(html).toContain('24 hours')
    expect(html).not.toContain('name="admin"')
    expect(html).not.toContain('sign out, sign in again')
  })

  it('shows nothing to a normal user, even on a listed return address', async () => {
    const clientId = await registerClient(CLAUDE)
    const res = await getPage(authorizePath(clientId, { redirectUri: CLAUDE, challenge: pkce().challenge }), await cookieFor(alice))
    const html = await res.text()
    expect(html).not.toContain('Approving gives')
    expect(html).not.toContain('name="admin"')
    expect(html).not.toContain('sign out, sign in again')
  })

  it('shows the notice to the owner whatever the age of the sign-in', async () => {
    const clientId = await registerClient(CLAUDE)
    const res = await getPage(authorizePath(clientId, { redirectUri: CLAUDE, challenge: pkce().challenge }), await cookieFor(admin, 86_400))
    const html = await res.text()
    expect(html).toContain('Approving gives')
    expect(html).not.toContain('sign out, sign in again')
  })

  it('shows nothing for the REST resource', async () => {
    const claudeClient = await registerClient(CLAUDE)
    const html = await (
      await getPage(authorizePath(claudeClient, { redirectUri: CLAUDE, challenge: pkce().challenge, resource: API }), await cookieFor(admin))
    ).text()
    expect(html).not.toContain('Approving gives')
    expect(html).not.toContain('sign out, sign in again')
  })

  it('shows the notice for any return address, with that host in bold', async () => {
    for (const redirect of [EVIL, LOOPBACK]) {
      const clientId = await registerClient(redirect)
      const html = await (await getPage(authorizePath(clientId, { redirectUri: redirect, challenge: pkce().challenge }), await cookieFor(admin))).text()
      expect(html).toContain('Approving gives')
      expect(html).toContain(`<strong>${new URL(redirect).host}</strong>`)
      expect(html).toContain('Check that the address above is your own AI app')
    }
  })

  it('shows nothing when ADMIN_DISABLED=1, even to the owner', async () => {
    process.env.ADMIN_DISABLED = '1'
    const clientId = await registerClient(CLAUDE)
    const html = await (await getPage(authorizePath(clientId, { redirectUri: CLAUDE, challenge: pkce().challenge }), await cookieFor(admin))).text()
    expect(html).not.toContain('Approving gives')
    expect(html).not.toContain('sign out, sign in again')
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
async function ownerApp(redirect = CLAUDE, cookieAge = 0) {
  const clientId = await registerClient(redirect)
  const { verifier, challenge } = pkce()
  const path = authorizePath(clientId, { redirectUri: redirect, challenge })
  const res = await approve(path, await cookieFor(admin, cookieAge))
  expect(res.status).toBe(302)
  const tokens = await exchange(new URL(res.headers.get('location')), clientId, redirect, verifier)
  return { token: tokens.access_token, clientId, path, res }
}

describe('an approval gives admin to the owner, and to nobody else', () => {
  it('the owner on the MCP resource: a normal redirect, admin for about 24 hours, admin tools at once', async () => {
    const { token, res } = await ownerApp()
    const location = new URL(res.headers.get('location'))
    expect(location.origin + location.pathname).toBe(CLAUDE)
    expect(location.searchParams.get('code')).toBeTruthy()
    expect(location.searchParams.get('state')).toBe('st-1')

    const grant = await grantOf(admin)
    const hours = (new Date(grant.admin_until).getTime() - Date.now()) / 3_600_000
    expect(hours).toBeGreaterThan(23.9)
    expect(hours).toBeLessThan(24.1)
    expect((await toolNames(token)).filter((name) => name.startsWith('admin_'))).toContain('admin_status')
    const audit = await db.pg.query("select action, outcome from admin_audit where action = 'elevate_connection'")
    expect(audit.rows).toEqual([{ action: 'elevate_connection', outcome: 'done' }])
  })

  it('a normal user gets no admin and no admin tools', async () => {
    const clientId = await registerClient(CLAUDE)
    const { verifier, challenge } = pkce()
    const res = await approve(authorizePath(clientId, { redirectUri: CLAUDE, challenge }), await cookieFor(alice))
    expect(res.status).toBe(302)
    noElevation(await grantOf(alice))
    const tokens = await exchange(new URL(res.headers.get('location')), clientId, CLAUDE, verifier)
    expect((await toolNames(tokens.access_token)).filter((name) => name.startsWith('admin_'))).toEqual([])
    expect((await db.pg.query('select count(*)::int as n from admin_audit')).rows[0].n).toBe(0)
  })

  it('the owner on the REST resource gets no admin', async () => {
    const clientId = await registerClient(CLAUDE)
    const res = await approve(authorizePath(clientId, { redirectUri: CLAUDE, challenge: pkce().challenge, resource: API }), await cookieFor(admin))
    expect(res.status).toBe(302)
    noElevation(await grantOf(admin, API))
  })

  it('ADMIN_DISABLED=1 at approval gives no admin, even to the owner', async () => {
    process.env.ADMIN_DISABLED = '1'
    const clientId = await registerClient(CLAUDE)
    const { verifier, challenge } = pkce()
    const res = await approve(authorizePath(clientId, { redirectUri: CLAUDE, challenge }), await cookieFor(admin))
    expect(res.status).toBe(302)
    noElevation(await grantOf(admin))
    const tokens = await exchange(new URL(res.headers.get('location')), clientId, CLAUDE, verifier)
    expect((await toolNames(tokens.access_token)).filter((name) => name.startsWith('admin_'))).toEqual([])
  })

  it('the owner with an old sign-in gets admin too: the age of the sign-in does not matter', async () => {
    const clientId = await registerClient(CLAUDE)
    const { verifier, challenge } = pkce()
    const path = authorizePath(clientId, { redirectUri: CLAUDE, challenge })
    const res = await approve(path, await cookieFor(admin, 86_400))
    expect(res.status).toBe(302)
    expect((await grantOf(admin)).admin_until).not.toBeNull()
    const tokens = await exchange(new URL(res.headers.get('location')), clientId, CLAUDE, verifier)
    expect(await toolNames(tokens.access_token)).toContain('admin_status')
  })

  it('an approval kills the tokens issued before it on the same MCP grant', async () => {
    const clientId = await registerClient(CLAUDE)
    const { verifier, challenge } = pkce()
    const path = authorizePath(clientId, { redirectUri: CLAUDE, challenge })
    const first = await approve(path, await cookieFor(admin))
    const tokens = await exchange(new URL(first.headers.get('location')), clientId, CLAUDE, verifier)
    expect(await resolveAccess(tokens.access_token, MCP)).not.toBeNull()

    expect((await approve(path, await cookieFor(admin))).status).toBe(302)
    expect(await resolveAccess(tokens.access_token, MCP)).toBeNull()
  })

  it('a session cookie that claims the owner id, for a normal user, gets nothing and elevates nothing', async () => {
    const clientId = await registerClient(CLAUDE)
    const path = authorizePath(clientId, { redirectUri: CLAUDE, challenge: pkce().challenge })
    const cookie = await cookieFor(alice, 0, String(ADMIN_GITHUB_ID))
    const html = await (await getPage(path, cookie)).text()
    expect(html).not.toContain('Approving gives')
    expect(html).not.toContain('sign out, sign in again')
    const res = await approve(path, cookie)
    expect(res.status).toBe(302)
    noElevation(await grantOf(alice))
    expect((await db.pg.query('select count(*)::int as n from admin_audit')).rows[0].n).toBe(0)
  })

  it('a revoke removes the admin tools', async () => {
    const { token, clientId } = await ownerApp()
    expect(await toolNames(token)).toContain('admin_status')
    const grant = await grantOf(admin)
    const res = await route(apiRequest(`/api/grants/${grant.id}`, { method: 'DELETE', cookie: await cookieFor(admin) }))
    expect(res.status).toBeLessThan(300)
    expect(clientId).toBeTruthy()
    const after = await route(
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
    expect(after.status).toBe(401)
  })

  it('admin ends when admin_until passes: the app lists no admin tool at all', async () => {
    const { token } = await ownerApp()
    await db.pg.query("update oauth_grants set admin_until = now() - interval '1 second' where user_id = $1", [admin.id])
    expect((await toolNames(token)).filter((name) => name.startsWith('admin_'))).toEqual([])
    expect((await callOn(token, 'admin_status', {})).error.message).toMatch(/unknown tool/)
  })
})

// ---- A device grant never elevates (plan item 8) ----------------------------------------------

describe('a device grant never carries an elevation', () => {
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

// ---- Admin tools at once ----------------------------------------------------------------------

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


describe('an owner connection gets admin tools at once', () => {
  it('lists the admin tools after the approval, answers admin_status admin true, and admin_stats is callable', async () => {
    const { token } = await ownerApp()
    const names = await toolNames(token)
    expect(names).toContain('whoami')
    expect(names).toContain('admin_status')
    expect(names).toContain('admin_stats')
    expect(names).not.toContain('admin_activate')
    const listed = await rpcOn(token, 'tools/list', {})
    expect(listed.result.cacheScope).toBe('private')

    const status = await callOn(token, 'admin_status', {})
    expect(status.result.isError).toBe(false)
    expect(status.result.structuredContent).toMatchObject({ admin: true })
    const stats = await callOn(token, 'admin_stats', {})
    expect(stats.result.isError).toBe(false)

    const grant = await grantOf(admin)
    const hours = (new Date(grant.admin_until).getTime() - Date.now()) / 3_600_000
    expect(hours).toBeGreaterThan(23.9)
    expect(hours).toBeLessThan(24.1)
  })
})
