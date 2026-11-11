import { query } from '../db.js'
import { fetchGithubUser, upsertGithubUser } from '../github-user.js'
import { HttpError, cookie, json, parseCookies } from '../http.js'
import { authenticate, clearSessionCookie, createSession, sessionCookie } from '../session.js'

const STATE_COOKIE = 'xt_oauth_state'
const RETURN_COOKIE = 'xt_oauth_return'

/** Only the MCP consent page may be a post-sign-in destination (plan 7.5, item 9): no scheme, no `//`. */
export function safeReturnTo(value) {
  if (typeof value !== 'string' || value.length > 2000) return null
  if (!value.startsWith('/api/oauth/authorize?')) return null
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code === 0x5c || code <= 0x1f) return null
  }
  return value
}
function appOrigin() {
  return process.env.PUBLIC_APP_URL.replace(/\/$/, '')
}

function callbackUrl() {
  return `${appOrigin()}/api/auth/callback`
}

function redirect(location, cookies = []) {
  const headers = new Headers({ location })
  for (const value of cookies) headers.append('set-cookie', value)
  return new Response(null, { status: 302, headers })
}

/**
 * GET /api/auth/login: starts the GitHub OAuth flow with a one-time state cookie.
 * Served on a host other than the canonical app origin (a per-deployment URL), it redirects to the
 * canonical origin first, so the state cookie and the callback always belong to one host.
 */
async function login({ request, url }) {
  const host = request.headers.get('x-forwarded-host') ?? url.host
  if (host !== new URL(appOrigin()).host) {
    return redirect(`${appOrigin()}/api/auth/login`)
  }
  const state = crypto.randomUUID()
  const returnTo = safeReturnTo(url.searchParams.get('return_to'))
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: callbackUrl(),
    scope: 'read:user',
    state
  })
  const cookies = [cookie(STATE_COOKIE, state, { maxAge: 600 })]
  if (returnTo) cookies.push(cookie(RETURN_COOKIE, returnTo, { maxAge: 600 }))
  return redirect(`https://github.com/login/oauth/authorize?${params}`, cookies)
}

async function exchangeCode(code) {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: callbackUrl()
    })
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.access_token) throw new HttpError(502, 'GitHub sign-in failed')
  return data.access_token
}

/**
 * GET /api/auth/callback: verifies state, upserts the user, issues the session cookie.
 * The GitHub access token is used once and never stored.
 */
async function callback({ request, url }) {
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const expected = parseCookies(request)[STATE_COOKIE]
  if (!code || !state || !expected || state !== expected) {
    throw new HttpError(400, 'Invalid OAuth state')
  }

  const accessToken = await exchangeCode(code)
  const github = await fetchGithubUser(accessToken)
  const user = await upsertGithubUser(github)

  const token = await createSession(user)
  const returnTo = safeReturnTo(parseCookies(request)[RETURN_COOKIE])
  return redirect(`${appOrigin()}${returnTo ?? '/'}`, [
    sessionCookie(token),
    cookie(STATE_COOKIE, '', { maxAge: 0 }),
    cookie(RETURN_COOKIE, '', { maxAge: 0 })
  ])
}

/** GET /api/auth/me: cookie session or bearer token. `user` is null when signed out. */
async function me({ request }) {
  const caller = await authenticate(request)
  if (!caller) return json({ user: null, auth: null })
  const { rows } = await query('select id, login, name, avatar_url from users where id = $1', [caller.uid])
  return json({ user: rows[0] ?? null, auth: rows[0] ? caller.via : null })
}

/** POST /api/auth/logout */
async function logout() {
  return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() })
}

export const authRoutes = [
  { method: 'GET', path: '/auth/login', handler: login },
  { method: 'GET', path: '/auth/callback', handler: callback },
  { method: 'GET', path: '/auth/me', handler: me, ci: true },
  { method: 'POST', path: '/auth/logout', handler: logout }
]
