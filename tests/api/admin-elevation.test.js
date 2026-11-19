// @vitest-environment node
// Admin plan A4: the consent box, the approval that adds admin, and the one-time pairing page.
// The pairing code is checked against its hash here and nowhere else: no test prints it.
import { createHash, randomBytes } from 'node:crypto'
import { SignJWT } from 'jose'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({ putBlob: vi.fn(), deleteBlobUrls: vi.fn(async () => {}) }))

import { route } from '../../server/router.js'
import { secretKey } from '../../server/session.js'
import { setMetadataResolverForTests } from '../../server/oauth/clients.js'
import { issuePair, resolveAccess } from '../../server/oauth/tokens.js'
import { pairingHash } from '../../server/admin/pairing.js'
import { APP_URL, apiRequest, setupTestDb } from './helpers/db.js'

const MCP = `${APP_URL}/api/mcp`
const API = `${APP_URL}/api`
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback'
const CHATGPT = 'https://chatgpt.com/connector_platform_oauth_redirect'
const EVIL = 'https://evil.example/cb'
const LOOPBACK = 'http://localhost/callback'
const ADMIN_GITHUB_ID = 960015
const LEGACY = '2025-11-25'
const FORM = { 'content-type': 'application/x-www-form-urlencoded' }
// The pairing code as shown: four characters, a hyphen, four characters, no look-alike letters.
const CODE_SHOWN = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/

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
async function approve(path, cookie, { admin: ticked = false } = {}) {
  const page = await getPage(path, cookie)
  expect(page.status).toBe(200)
  const form = new URLSearchParams({ request: decisionOf(await page.text()), decision: 'approve' })
  if (ticked) form.set('admin', '1')
  return route(apiRequest('/api/oauth/authorize', { method: 'POST', body: form.toString(), headers: FORM, cookie }))
}

/** The pairing page's code and continue link. The code is read from the page only. */
async function pairingFrom(res) {
  expect(res.status).toBe(200)
  const html = await res.text()
  const code = html.match(/<p class="code"[^>]*>([^<]+)<\/p>/)[1]
  const href = html.match(/<a class="continue" href="([^"]+)"/)[1].replaceAll('&#38;', '&')
  return { html, code, link: new URL(href) }
}

async function grantOf(user, resource = MCP) {
  const { rows } = await db.pg.query(
    `select id, admin_until, admin_pending_hash, admin_pending_tries,
            extract(epoch from admin_pending_until - now())::float8 as pending_seconds
       from oauth_grants where user_id = $1 and resource = $2`,
    [user.id, resource]
  )
  const grant = rows[0]
  return { ...grant, pending_seconds: grant.pending_seconds === null ? null : Number(grant.pending_seconds) }
}

const noElevation = (grant) =>
  expect({
    admin_until: grant.admin_until,
    admin_pending_hash: grant.admin_pending_hash,
    admin_pending_until: grant.pending_seconds,
    admin_pending_tries: grant.admin_pending_tries
  }).toEqual({ admin_until: null, admin_pending_hash: null, admin_pending_until: null, admin_pending_tries: 0 })

/** Exchanges an authorization code from a redirect or a pairing link for a token pair. */
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

// ---- The consent box (plan item 5) ------------------------------------------------------------

describe('the consent box is shown to the owner and to nobody else', () => {
  it('shows the box to the owner on a fresh sign-in, for the MCP resource and a Claude return address', async () => {
    const clientId = await registerClient(CLAUDE)
    const res = await getPage(authorizePath(clientId, { redirectUri: CLAUDE, challenge: pkce().challenge }), await cookieFor(admin))
    const html = await res.text()
    expect(res.status).toBe(200)
    expect(html).toContain('name="admin" value="1"')
    expect(html).toContain('for the app at <strong>claude.ai</strong>')
    expect(html).not.toContain('sign out, sign in again')
  })

  it('shows the box for the ChatGPT return address too', async () => {
    const clientId = await registerClient(CHATGPT)
    const res = await getPage(authorizePath(clientId, { redirectUri: CHATGPT, challenge: pkce().challenge }), await cookieFor(admin))
    expect(await res.text()).toContain('name="admin" value="1"')
  })

  it('shows nothing to a normal user, even on a listed return address', async () => {
    const clientId = await registerClient(CLAUDE)
    const res = await getPage(authorizePath(clientId, { redirectUri: CLAUDE, challenge: pkce().challenge }), await cookieFor(alice))
    const html = await res.text()
    expect(html).not.toContain('name="admin"')
    expect(html).not.toContain('sign out, sign in again')
  })

  it('shows only the sign-in hint when the owner signed in more than 10 minutes ago', async () => {
    const clientId = await registerClient(CLAUDE)
    const res = await getPage(authorizePath(clientId, { redirectUri: CLAUDE, challenge: pkce().challenge }), await cookieFor(admin, 660))
    const html = await res.text()
    expect(html).not.toContain('name="admin"')
    expect(html).toContain('sign out, sign in again and come back to this page within 10 minutes')
  })

  it('shows nothing for the REST resource, an unlisted return address or a loopback address', async () => {
    const claudeClient = await registerClient(CLAUDE)
    const evilClient = await registerClient(EVIL)
    const loopbackClient = await registerClient(LOOPBACK)
    const cases = [
      authorizePath(claudeClient, { redirectUri: CLAUDE, challenge: pkce().challenge, resource: API }),
      authorizePath(evilClient, { redirectUri: EVIL, challenge: pkce().challenge }),
      authorizePath(loopbackClient, { redirectUri: LOOPBACK, challenge: pkce().challenge })
    ]
    for (const path of cases) {
      const html = await (await getPage(path, await cookieFor(admin))).text()
      expect(html).not.toContain('name="admin"')
      expect(html).not.toContain('sign out, sign in again')
    }
  })

  it('shows nothing when ADMIN_DISABLED=1, even to the owner', async () => {
    process.env.ADMIN_DISABLED = '1'
    const clientId = await registerClient(CLAUDE)
    const html = await (await getPage(authorizePath(clientId, { redirectUri: CLAUDE, challenge: pkce().challenge }), await cookieFor(admin))).text()
    expect(html).not.toContain('name="admin"')
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

// ---- The approval with the box ticked (plan items 6 and 7) ------------------------------------

describe('an approval with the box ticked gives the owner a one-time pairing page', () => {
  it('shows the code once on the page and sends nothing else with it', async () => {
    const clientId = await registerClient(CLAUDE)
    const { verifier, challenge } = pkce()
    const path = authorizePath(clientId, { redirectUri: CLAUDE, challenge })
    const { code, link, html } = await pairingFrom(await approve(path, await cookieFor(admin), { admin: true }))

    expect(code).toMatch(CODE_SHOWN)
    expect(html).toContain('Admin pairing code')
    // The continue link is the redirect a 302 would have used: the app, the OAuth code, the state and the issuer.
    expect(link.origin + link.pathname).toBe(CLAUDE)
    expect(link.searchParams.get('code')).toBeTruthy()
    expect(link.searchParams.get('state')).toBe('st-1')
    expect(link.searchParams.get('iss')).toBe(APP_URL)
    // The pairing code is not in the link, in the audit log, or in any other row.
    expect(link.toString()).not.toContain(code.replace('-', ''))
    const audit = await db.pg.query('select * from admin_audit')
    expect(JSON.stringify(audit.rows)).not.toContain(code.replace('-', ''))
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0]).toMatchObject({ action: 'elevate_requested', outcome: 'done', actor_login: 'Shaked', target_user_id: null })

    // Only the hash is stored, bound to the grant. The grant is not admin yet (A5 activates it).
    const grant = await grantOf(admin)
    expect(grant.admin_pending_hash).toBe(pairingHash(grant.id, code))
    expect(grant.admin_pending_hash).not.toBe(pairingHash(grant.id, 'AAAA-AAAA'))
    expect(grant.admin_until).toBeNull()
    expect(grant.admin_pending_tries).toBe(0)
    expect(grant.pending_seconds).toBeGreaterThan(9 * 60)
    expect(grant.pending_seconds).toBeLessThan(10.5 * 60)

    // The OAuth code lasts 5 minutes here, and the token answer carries no pairing code.
    const expiry = await db.pg.query('select extract(epoch from expires_at - now())::float8 as seconds from oauth_codes where grant_id = $1', [grant.id])
    expect(Number(expiry.rows[0].seconds)).toBeGreaterThan(4 * 60)
    expect(Number(expiry.rows[0].seconds)).toBeLessThan(5.5 * 60)
    const tokens = await exchange(link, clientId, CLAUDE, verifier)
    expect(tokens.scope).toBe('drafts')
    expect(JSON.stringify(tokens)).not.toContain(code.replace('-', ''))
    // Nothing is admin yet: the pending connection lists only admin_activate (plan A5).
    expect((await toolNames(tokens.access_token)).filter((name) => name.startsWith('admin_'))).toEqual(['admin_activate'])
  })

  it.each([
    ['a normal user', () => alice, { resource: undefined, redirect: CLAUDE, age: 0 }],
    ['the owner with a sign-in older than 10 minutes', () => admin, { resource: undefined, redirect: CLAUDE, age: 660 }],
    ['the owner on the REST resource', () => admin, { resource: API, redirect: CLAUDE, age: 0 }],
    ['the owner with an unlisted return address', () => admin, { resource: undefined, redirect: EVIL, age: 0 }],
    ['the owner with a loopback return address', () => admin, { resource: undefined, redirect: LOOPBACK, age: 0 }]
  ])('a posted box from %s is ignored: a normal approval and the normal redirect', async (_, who, { resource, redirect, age }) => {
    const clientId = await registerClient(redirect)
    const user = who()
    const path = authorizePath(clientId, { redirectUri: redirect, challenge: pkce().challenge, resource })
    const res = await approve(path, await cookieFor(user, age), { admin: true })

    expect(res.status).toBe(302)
    const location = new URL(res.headers.get('location'))
    expect(location.origin + location.pathname).toBe(redirect)
    expect(location.searchParams.get('code')).toBeTruthy()
    noElevation(await grantOf(user, resource ?? MCP))
  })

  it('records a refused attempt only for the owner, and nothing for anyone else', async () => {
    const clientId = await registerClient(EVIL)
    await approve(authorizePath(clientId, { redirectUri: EVIL, challenge: pkce().challenge }), await cookieFor(admin), { admin: true })
    const audit = await db.pg.query('select action, outcome from admin_audit')
    expect(audit.rows).toEqual([{ action: 'elevate_requested', outcome: 'refused' }])

    await db.pg.exec('delete from admin_audit')
    const normal = await registerClient(CLAUDE)
    await approve(authorizePath(normal, { redirectUri: CLAUDE, challenge: pkce().challenge }), await cookieFor(alice), { admin: true })
    expect((await db.pg.query('select count(*)::int as n from admin_audit')).rows[0].n).toBe(0)
  })

  it('an approval without the box ends an earlier elevation and kills the tokens issued before it', async () => {
    const clientId = await registerClient(CLAUDE)
    const { verifier, challenge } = pkce()
    const path = authorizePath(clientId, { redirectUri: CLAUDE, challenge, resource: API })
    const first = await approve(path, await cookieFor(admin))
    expect(first.status).toBe(302)
    const tokens = await exchange(new URL(first.headers.get('location')), clientId, CLAUDE, verifier)
    const bearer = { authorization: `Bearer ${tokens.access_token}` }
    expect((await route(apiRequest('/api/drafts?published=false', { method: 'GET', headers: bearer }))).status).toBe(200)

    // The owner is elevated by hand (SQL, as a test stands in for A5), then approves again without the box.
    await db.pg.query("update oauth_grants set admin_until = now() + interval '1 day' where user_id = $1 and resource = $2", [admin.id, API])
    const again = await approve(path, await cookieFor(admin))
    expect(again.status).toBe(302)
    noElevation(await grantOf(admin, API))
    expect((await route(apiRequest('/api/drafts?published=false', { method: 'GET', headers: bearer }))).status).toBe(401)
  })

  it('a session cookie that claims the owner id, for a normal user, gets nothing and elevates nothing', async () => {
    const clientId = await registerClient(CLAUDE)
    const path = authorizePath(clientId, { redirectUri: CLAUDE, challenge: pkce().challenge })
    const cookie = await cookieFor(alice, 0, String(ADMIN_GITHUB_ID))
    const html = await (await getPage(path, cookie)).text()
    expect(html).not.toContain('name="admin"')
    expect(html).not.toContain('sign out, sign in again')
    const res = await approve(path, cookie, { admin: true })
    expect(res.status).toBe(302)
    noElevation(await grantOf(alice))
    expect((await db.pg.query('select count(*)::int as n from admin_audit')).rows[0].n).toBe(0)
  })

  it('an elevated approval kills the tokens issued earlier on the same MCP grant', async () => {
    const clientId = await registerClient(CLAUDE)
    const { verifier, challenge } = pkce()
    const path = authorizePath(clientId, { redirectUri: CLAUDE, challenge })
    const first = await approve(path, await cookieFor(admin))
    const tokens = await exchange(new URL(first.headers.get('location')), clientId, CLAUDE, verifier)
    expect(await resolveAccess(tokens.access_token, MCP)).not.toBeNull()

    const elevated = await approve(path, await cookieFor(admin), { admin: true })
    await pairingFrom(elevated)
    expect(await resolveAccess(tokens.access_token, MCP)).toBeNull()
  })

  it('a normal approval clears a pending pairing code left by an earlier elevated approval', async () => {
    const clientId = await registerClient(CLAUDE)
    const path = authorizePath(clientId, { redirectUri: CLAUDE, challenge: pkce().challenge })
    await pairingFrom(await approve(path, await cookieFor(admin), { admin: true }))
    expect((await grantOf(admin)).admin_pending_hash).not.toBeNull()
    expect((await approve(path, await cookieFor(admin))).status).toBe(302)
    noElevation(await grantOf(admin))
  })

  it('escapes the state on the pairing page', async () => {
    const clientId = await registerClient(CLAUDE)
    const res = await approve(
      authorizePath(clientId, { redirectUri: CLAUDE, challenge: pkce().challenge, state: '"<>&' }),
      await cookieFor(admin),
      { admin: true }
    )
    const { html } = await pairingFrom(res)
    expect(html).not.toContain('"<>&')
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
      "select admin_until, admin_pending_hash, admin_pending_until, admin_pending_tries from oauth_grants where client_id = 'device:claude'"
    )
    expect(rows).toEqual([{ admin_until: null, admin_pending_hash: null, admin_pending_until: null, admin_pending_tries: 0 }])
  })
})

// ---- admin_activate: the pairing code turns admin on (plan A5) ---------------------------------

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
const textOf = (answer) => answer.result.content[0].text

/** Approves with the box for a return address and exchanges the code: the pending connection and its code. */
async function pendingApp(redirect, { ticked = true } = {}) {
  const clientId = await registerClient(redirect)
  const { verifier, challenge } = pkce()
  const path = authorizePath(clientId, { redirectUri: redirect, challenge })
  const { code, link } = await pairingFrom(await approve(path, await cookieFor(admin), { admin: ticked }))
  const tokens = await exchange(link, clientId, redirect, verifier)
  return { code, token: tokens.access_token, clientId }
}

describe('admin_activate: the pairing code turns admin on for this connection', () => {
  it('the app lists only admin_activate; the right code turns admin on for 24 hours; then the admin tools show', async () => {
    const { code, token } = await pendingApp(CLAUDE)
    const names = await toolNames(token)
    expect(names).toContain('whoami')
    expect(names.filter((name) => name.startsWith('admin_'))).toEqual(['admin_activate'])
    const listed = await rpcOn(token, 'tools/list', {})
    expect(listed.result.cacheScope).toBe('private')
    expect((await callOn(token, 'admin_status', {})).error.message).toMatch(/unknown tool/)

    const done = await callOn(token, 'admin_activate', { code })
    expect(done.result.isError).toBe(false)
    expect(done.result.structuredContent).toMatchObject({ admin: true })

    const grant = await grantOf(admin)
    const hours = (new Date(grant.admin_until).getTime() - Date.now()) / 3_600_000
    expect(hours).toBeGreaterThan(23.9)
    expect(hours).toBeLessThan(24.1)
    expect(grant).toMatchObject({ admin_pending_hash: null, admin_pending_tries: 0 })

    const after = await toolNames(token)
    expect(after).toContain('admin_status')
    expect(after).not.toContain('admin_activate')
    expect((await callOn(token, 'admin_status', {})).result.structuredContent).toMatchObject({ admin: true })

    const audit = await db.pg.query("select action, outcome, details from admin_audit where action = 'elevate_connection'")
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0]).toMatchObject({ outcome: 'done', details: { hours: 24 } })
    expect(JSON.stringify(audit.rows)).not.toContain(code.replace('-', ''))
    expect(JSON.stringify(done)).not.toContain(code.replace('-', ''))
  })

  it('three wrong codes cancel the code: each is a 400, the third says start again, and a right code then is an unknown tool', async () => {
    const { code, token } = await pendingApp(CLAUDE)
    // A guess that happens to equal the real code is not a wrong guess; none of these can, but the test says so.
    const guesses = ['AAAA-AAAA', 'BBBB-BBBB', 'CCCC-CCCC'].filter((guess) => guess !== code)
    const first = await callOn(token, 'admin_activate', { code: guesses[0] })
    expect(first.result.isError).toBe(true)
    expect(textOf(first)).toContain('2 tries left')
    const second = await callOn(token, 'admin_activate', { code: guesses[1] })
    expect(textOf(second)).toContain('1 try left')
    const third = await callOn(token, 'admin_activate', { code: guesses[2] })
    expect(third.result.isError).toBe(true)
    expect(textOf(third)).toContain('Start again: connect the app and tick the box')

    const grant = await grantOf(admin)
    expect(grant).toMatchObject({ admin_until: null, admin_pending_hash: null, pending_seconds: null, admin_pending_tries: 0 })
    expect((await callOn(token, 'admin_activate', { code })).error.message).toMatch(/unknown tool/)
    expect(await toolNames(token)).not.toContain('admin_activate')

    const refused = await db.pg.query("select outcome, details from admin_audit where action = 'elevate_connection' order by created_at")
    expect(refused.rows.map((row) => row.details)).toEqual([{ tries: 1 }, { tries: 2 }, { tries: 3 }])
    expect(JSON.stringify(refused.rows)).not.toContain(code.replace('-', ''))
  })

  it('a code whose time has run out is an unknown tool, and the app does not list admin_activate', async () => {
    const { code, token } = await pendingApp(CLAUDE)
    await db.pg.query("update oauth_grants set admin_pending_until = now() - interval '1 second' where admin_pending_hash is not null")
    expect(await toolNames(token)).not.toContain('admin_activate')
    expect((await callOn(token, 'admin_activate', { code })).error.message).toMatch(/unknown tool/)
    expect((await grantOf(admin)).admin_until).toBeNull()
  })

  it('a code is good for its own connection only: on a second pending connection of the same user it is a wrong try there', async () => {
    const first = await pendingApp(CLAUDE)
    const second = await pendingApp(CHATGPT)
    const wrongHere = await callOn(second.token, 'admin_activate', { code: first.code })
    expect(textOf(wrongHere)).toContain('2 tries left')

    const { rows } = await db.pg.query('select client_id, admin_pending_tries, admin_until from oauth_grants where user_id = $1 order by client_id', [admin.id])
    const byClient = Object.fromEntries(rows.map((row) => [row.client_id, row]))
    expect(byClient[second.clientId]).toMatchObject({ admin_pending_tries: 1, admin_until: null })
    expect(byClient[first.clientId]).toMatchObject({ admin_pending_tries: 0, admin_until: null })

    expect((await callOn(first.token, 'admin_activate', { code: first.code })).result.isError).toBe(false)
    const after = await db.pg.query('select client_id, admin_until from oauth_grants where user_id = $1 order by client_id', [admin.id])
    expect(after.rows.find((row) => row.client_id === first.clientId).admin_until).not.toBeNull()
    expect(after.rows.find((row) => row.client_id === second.clientId).admin_until).toBeNull()
  })

  it('admin ends when admin_until passes: the app lists no admin tool at all', async () => {
    const { code, token } = await pendingApp(CLAUDE)
    await callOn(token, 'admin_activate', { code })
    await db.pg.query("update oauth_grants set admin_until = now() - interval '1 second' where user_id = $1", [admin.id])
    const names = await toolNames(token)
    expect(names.filter((name) => name.startsWith('admin_'))).toEqual([])
    expect((await callOn(token, 'admin_status', {})).error.message).toMatch(/unknown tool/)
  })

  it('a normal user with pending columns set by SQL gets no admin_activate', async () => {
    const grant = await db.pg.query(
      `insert into oauth_grants (user_id, client_id, scope, resource) values ($1, $2, 'drafts', $3) returning id`,
      [alice.id, await registerClient(CLAUDE), MCP]
    )
    await db.pg.query("update oauth_grants set admin_pending_hash = $2, admin_pending_until = now() + interval '10 minutes' where id = $1", [
      grant.rows[0].id,
      pairingHash(grant.rows[0].id, 'ABCD-EFGH')
    ])
    const pair = await issuePair(grant.rows[0].id)
    // The token knows its grant is pending; the admin check (the GitHub id) keeps the tool away from a normal user.
    expect(await resolveAccess(pair.access_token, MCP)).toMatchObject({ admin: false })
    expect((await toolNames(pair.access_token)).filter((name) => name.startsWith('admin_'))).toEqual([])
    expect((await callOn(pair.access_token, 'admin_activate', { code: 'ABCD-EFGH' })).error.message).toMatch(/unknown tool/)
  })

  it('a pending column on the REST resource grant gives no admin flag at all', async () => {
    const grant = await db.pg.query(
      `insert into oauth_grants (user_id, client_id, scope, resource) values ($1, $2, 'drafts', $3) returning id`,
      [admin.id, await registerClient(CLAUDE), API]
    )
    await db.pg.query("update oauth_grants set admin_pending_hash = $2, admin_pending_until = now() + interval '10 minutes' where id = $1", [
      grant.rows[0].id,
      pairingHash(grant.rows[0].id, 'ABCD-EFGH')
    ])
    const pair = await issuePair(grant.rows[0].id)
    expect(await resolveAccess(pair.access_token, API)).toMatchObject({ adminPending: false, admin: false })
  })

  it('ADMIN_DISABLED=1 hides admin_activate even from the owner', async () => {
    const { token } = await pendingApp(CLAUDE)
    process.env.ADMIN_DISABLED = '1'
    expect((await toolNames(token)).filter((name) => name.startsWith('admin_'))).toEqual([])
  })
})
