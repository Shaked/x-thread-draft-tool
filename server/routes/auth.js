import { query } from '../db.js'
import { HttpError, cookie, json, parseCookies } from '../http.js'
import { clearSessionCookie, createSession, readSession, sessionCookie } from '../session.js'

const STATE_COOKIE = 'xt_oauth_state'
const UPSERT_USER = `
  insert into users (github_id, login, name, avatar_url)
  values ($1, $2, $3, $4)
  on conflict (github_id) do update set
    login = excluded.login,
    name = excluded.name,
    avatar_url = excluded.avatar_url,
    updated_at = now()
  returning *`

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
export async function login() {
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

async function fetchGithubUser(accessToken) {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      authorization: `Bearer ${accessToken}`,
      'user-agent': 'x-thread-draft-tool',
      accept: 'application/vnd.github+json'
    }
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data?.id || !data?.login) throw new HttpError(502, 'GitHub sign-in failed')
  return data
}

/**
 * GET /api/auth/callback: verifies state, upserts the user, issues the session cookie.
 * The GitHub access token is used once and never stored.
 */
export async function callback({ request, url }) {
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const expected = parseCookies(request)[STATE_COOKIE]
  if (!code || !state || !expected || state !== expected) {
    throw new HttpError(400, 'Invalid OAuth state')
  }

  const accessToken = await exchangeCode(code)
  const github = await fetchGithubUser(accessToken)
  const { rows } = await query(UPSERT_USER, [
    github.id,
    github.login,
    github.name ?? null,
    github.avatar_url ?? null
  ])

  const token = await createSession(rows[0])
  return redirect(`${appOrigin()}/`, [sessionCookie(token), cookie(STATE_COOKIE, '', { maxAge: 0 })])
}

/** GET /api/auth/me: always 200; `user` is null when signed out. */
export async function me({ request }) {
  const session = await readSession(request)
  if (!session) return json({ user: null })
  const { rows } = await query('select id, login, name, avatar_url from users where id = $1', [session.uid])
  return json({ user: rows[0] ?? null })
}

/** POST /api/auth/logout */
export async function logout() {
  return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() })
}

export const authRoutes = [
  { method: 'GET', path: '/auth/login', handler: login },
  { method: 'GET', path: '/auth/callback', handler: callback },
  { method: 'GET', path: '/auth/me', handler: me },
  { method: 'POST', path: '/auth/logout', handler: logout }
]
