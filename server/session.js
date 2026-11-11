import { SignJWT, jwtVerify } from 'jose'
import { cookie, parseCookies, HttpError } from './http.js'
import { findUserByToken } from './tokens.js'
import { resolveAccess } from './oauth/tokens.js'
import { verifyCiToken } from './oidc-ci.js'
import { upsertGithubUser } from './github-user.js'
import { currentCaller } from './caller-context.js'

// The CI identity: a dedicated row in users (github_id -1; real GitHub ids are positive).
const CI_USER = { id: -1, login: 'ci-smoke', name: 'CI', avatar_url: null }

const SESSION_COOKIE = 'xt_session'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30

export function secretKey() {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET is not set')
  return new TextEncoder().encode(secret)
}

/** Signed HS256 JWT with payload { uid, gh, login }, valid for 30 days. */
export async function createSession(user) {
  return new SignJWT({ uid: user.id, gh: String(user.github_id), login: user.login })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secretKey())
}

/** Returns the session payload, or null when missing, invalid or expired. */
export async function readSession(request) {
  const token = parseCookies(request)[SESSION_COOKIE]
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] })
    // Browser sessions never carry an audience. Consent decisions do (server/oauth/consent.js), so a
    // consent token copied from the consent page must not work as a session cookie.
    if (payload.aud !== undefined) return null
    return payload
  } catch {
    return null
  }
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
 * Returns `{ uid, gh, login, via: 'token' | 'session' }`, or null when signed out.
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
      if (!user) throw new HttpError(401, 'Invalid or expired API token')
      return user
    }
    // OAuth access token (1 hour), bound to the REST API resource `<origin>/api` (RFC 8707).
    const access = header.match(/^Bearer (xta_[A-Za-z0-9_-]{43})$/)
    if (access) {
      const user = await resolveAccess(access[1], apiResource(request))
      if (!user) throw new HttpError(401, 'Invalid or expired API token')
      return user
    }
    // A three-part JWT is a GitHub Actions identity token (see server/oidc-ci.js).
    const jwt = header.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/)
    if (jwt && jwt[1].length <= 4096) {
      const claims = await verifyCiToken(jwt[1])
      if (!claims) throw new HttpError(401, 'Invalid or expired API token')
      const row = await upsertGithubUser(CI_USER)
      return { uid: row.id, gh: '-1', login: CI_USER.login, via: 'ci-oidc' }
    }
    throw new HttpError(401, 'Invalid or expired API token')
  }
  const session = await readSession(request)
  return session ? { ...session, via: 'session' } : null
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
