import { query } from '../db.js'
import { fetchGithubUser, upsertGithubUser } from '../github-user.js'
import { HttpError, cookie, json, parseCookies } from '../http.js'
import { authenticate, clearSessionCookie, createSession, sessionCookie } from '../session.js'

const STATE_COOKIE = 'xt_oauth_state'
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

/** GET /api/auth/login: starts the GitHub OAuth flow with a one-time state cookie. */
async function login() {
  const state = crypto.randomUUID()
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: callbackUrl(),
    scope: 'read:user',
    state
  })
  return redirect(`https://github.com/login/oauth/authorize?${params}`, [
    cookie(STATE_COOKIE, state, { maxAge: 600 })
  ])
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
  return redirect(`${appOrigin()}/`, [sessionCookie(token), cookie(STATE_COOKIE, '', { maxAge: 0 })])
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
