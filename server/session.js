import { SignJWT, jwtVerify } from 'jose'
import { cookie, parseCookies, HttpError } from './http.js'
import { findUserByToken } from './tokens.js'

export const SESSION_COOKIE = 'xt_session'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30

function secretKey() {
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
  const header = request.headers.get('authorization')
  if (header !== null) {
    const match = header.match(/^Bearer (xt_[A-Za-z0-9_-]{40,})$/)
    const user = match ? await findUserByToken(match[1]) : null
    if (!user) throw new HttpError(401, 'Invalid or expired API token')
    return user
  }
  const session = await readSession(request)
  return session ? { ...session, via: 'session' } : null
}

export async function requireUser(request) {
  const user = await authenticate(request)
  if (!user) throw new HttpError(401, 'Not authenticated')
  return user
}

/** Like requireUser, but a bearer token is refused (creating tokens needs a human browser session). */
export async function requireSessionUser(request) {
  const user = await requireUser(request)
  if (user.via !== 'session') throw new HttpError(403, 'This action needs a signed-in browser session')
  return user
}
