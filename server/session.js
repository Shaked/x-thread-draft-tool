import { randomBytes } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import { query } from './db.js'
import { cookie, parseCookies, HttpError } from './http.js'
import { findUserByToken, isExpiredApiToken } from './tokens.js'
import { resolveAccess } from './oauth/tokens.js'
import { verifyCiToken } from './oidc-ci.js'
import { upsertGithubUser } from './github-user.js'
import { currentCaller } from './caller-context.js'
import { noteCaller } from './perf.js'
import { SUSPENDED_MESSAGE, admit } from './suspension.js'
import { roleOf } from './admin/role.js'

// The CI identity: a dedicated row in users (github_id -1; real GitHub ids are positive).
const CI_USER = { id: -1, login: 'ci-smoke', name: 'CI', avatar_url: null }

const SESSION_COOKIE = 'xt_session'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30

export function secretKey() {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET is not set')
  return new TextEncoder().encode(secret)
}

/** Signed HS256 JWT with payload { uid, gh, login, jti }, valid for 30 days. The jti (192 random bits) lets sign-out revoke it. */
export async function createSession(user) {
  return new SignJWT({ uid: user.id, gh: String(user.github_id), login: user.login, jti: randomBytes(24).toString('base64url') })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secretKey())
}

/** The payload of a valid session cookie, or null. Checks the signature, the audience and the jti; no database. */
async function verifiedPayload(request) {
  const token = parseCookies(request)[SESSION_COOKIE]
  if (!token) return null
  let payload
  try {
    ;({ payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] }))
  } catch {
    return null
  }
  // Browser sessions never carry an audience. Consent decisions do (server/oauth/consent.js), so a
  // consent token copied from the consent page must not work as a session cookie.
  if (payload.aud !== undefined) return null
  // A token without a jti predates sign-out revocation and cannot be revoked, so it is refused.
  if (typeof payload.jti !== 'string' || payload.jti === '') return null
  return payload
}

/**
 * The state of a verified session payload: `{ session }` (the payload), `{ suspended: true }`, or null when
 * revoked or the user is gone. One statement answers all three questions (revoked? suspended? still there?),
 * so suspension adds no round trip.
 */
async function stateOf(payload) {
  // Outside the try: a database error is a server error, never "signed out".
  const { rows } = await query(
    `select exists(select 1 from revoked_sessions where jti = $1) as revoked,
            (select suspended_at from users where id = $2) as suspended_at,
            exists(select 1 from users where id = $2) as found`,
    [payload.jti, payload.uid]
  )
  const row = rows[0]
  if (row.revoked || !row.found) return null
  // The payload rides along only so that sign-out can revoke it; every other caller treats suspended as no session.
  if (row.suspended_at !== null) return { suspended: true, session: payload }
  return { session: payload }
}

async function sessionState(request) {
  const payload = await verifiedPayload(request)
  return payload === null ? null : stateOf(payload)
}

/**
 * The web admin caller (#283), or null. It is the real browser session: view-as (Task 15) never applies here.
 * Checked in this order, and every check before the last runs without a database query:
 * not an in-process MCP call, no Authorization header, `x-xt-admin: 1`, a verified session cookie, the admin role.
 * Only then the revoked, suspended and exists statement. A custom header forces a CORS preflight, which this API never allows.
 */
export async function realSession(request) {
  if (currentCaller() !== null) return null
  if (request.headers.get('authorization') !== null) return null
  if (request.headers.get('x-xt-admin') !== '1') return null
  const payload = await verifiedPayload(request)
  if (payload === null || roleOf(payload.gh) !== 'admin') return null
  const state = await stateOf(payload)
  if (state === null || state.suspended) return null
  noteCaller('web')
  return { ...payload, via: 'session', suspended: false }
}

/**
 * Returns the session payload, or null when there is no usable session. A suspended user has none,
 * except for sign-out (`includeSuspended`), which must still be able to revoke the session.
 */
export async function readSession(request, { includeSuspended = false } = {}) {
  const state = await sessionState(request)
  if (!state || (state.suspended && !includeSuspended)) return null
  // A cookie session is a browser caller, on this path too (OAuth consent, sign-out) (plan O2).
  noteCaller('web')
  return state.session
}

/**
 * Ends a session on the server: its jti is refused from now on, until the token would have expired
 * anyway. Rows past their expiry are removed in the same statement. `session` comes from readSession.
 */
export async function revokeSession(session) {
  await query(
    `with expired as (delete from revoked_sessions where expires_at < now())
     insert into revoked_sessions (jti, expires_at) values ($1, to_timestamp($2))
     on conflict (jti) do nothing`,
    [session.jti, session.exp]
  )
}

export function sessionCookie(token) {
  return cookie(SESSION_COOKIE, token, { maxAge: MAX_AGE_SECONDS })
}

export function clearSessionCookie() {
  return cookie(SESSION_COOKIE, '', { maxAge: 0 })
}

/**
 * Who is calling. An Authorization header is the only credential considered when present:
 * an invalid, expired or revoked token is a 401 and never falls back to the cookie.
 * Returns `{ uid, gh, login, via, suspended: false }`, or null when signed out. Every path ends in `admit`:
 * a suspended user is a 403, and a caller without the flag is an error (fail closed).
 */
export async function authenticate(request) {
  // An in-process MCP tool call (server/mcp/tools.js) runs as the token's user.
  const caller = currentCaller()
  if (caller) return caller
  const header = request.headers.get('authorization')
  if (header !== null) {
    const match = header.match(/^Bearer (xt_[A-Za-z0-9_-]{40,})$/)
    if (match) {
      const user = await findUserByToken(match[1])
      if (!user) throw await refusedHandmadeToken(match[1])
      noteCaller('token')
      return admit(user)
    }
    // OAuth access token (1 hour), bound to the REST API resource `<origin>/api` (RFC 8707).
    const access = header.match(/^Bearer (xta_[A-Za-z0-9_-]{43})$/)
    if (access) {
      const user = await resolveAccess(access[1], apiResource(request))
      if (!user) throw new HttpError(401, 'Invalid or expired API token')
      noteCaller('token')
      return admit(user)
    }
    // A three-part JWT is a GitHub Actions identity token (see server/oidc-ci.js).
    const jwt = header.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/)
    if (jwt && jwt[1].length <= 4096) {
      const claims = await verifyCiToken(jwt[1])
      if (!claims) throw new HttpError(401, 'Invalid or expired API token')
      const row = await upsertGithubUser(CI_USER)
      noteCaller('ci')
      return admit({ uid: row.id, gh: '-1', login: CI_USER.login, via: 'ci-oidc', suspended: row.suspended_at !== null })
    }
    throw new HttpError(401, 'Invalid or expired API token')
  }
  const state = await sessionState(request)
  if (!state) return null
  if (state.suspended) throw new HttpError(403, SUSPENDED_MESSAGE)
  noteCaller('web')
  return admit({ ...state.session, via: 'session', suspended: false })
}

/** A hand-made token that has expired (7-day cap or its expiry) gets a message that says so. */
async function refusedHandmadeToken(token) {
  if (await isExpiredApiToken(token)) {
    return new HttpError(
      401,
      'This API token has expired. Hand-made tokens last 7 days at most. Create a new token at /settings/tokens, or connect with the device flow (POST /api/auth/device/start) or OAuth (MCP at /api/mcp).'
    )
  }
  return new HttpError(401, 'Invalid or expired API token')
}

/** The REST API resource that OAuth access tokens are issued for: `<origin>/api`. */
export function apiResource(request) {
  const origin = (process.env.PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '')
  return `${origin}/api`
}

export async function requireUser(request) {
  const user = await authenticate(request)
  if (!user) throw new HttpError(401, 'Not authenticated')
  return user
}

/**
 * Personal-token management (listing and revoking API tokens): a browser session or a hand-made
 * `xt_` token. OAuth access tokens are refused, since they are granted for drafts and nothing else.
 */
export async function requirePersonalUser(request) {
  const user = await requireUser(request)
  if (user.via !== 'session' && user.via !== 'token') {
    throw new HttpError(403, 'Managing API tokens needs a browser session or a personal API token, not an OAuth grant')
  }
  return user
}

/** Like requireUser, but a bearer token is refused (creating tokens needs a human browser session). */
export async function requireSessionUser(request) {
  const user = await requireUser(request)
  if (user.via !== 'session') throw new HttpError(403, 'This action needs a signed-in browser session')
  return user
}
