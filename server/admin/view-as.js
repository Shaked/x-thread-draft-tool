// The "view as" claim (#289, plan Task 15): a signed cookie that lets the admin's own browser session read the app as
// another user. Built like server/admin/confirm.js: HS256 with the session secret, bound to its own audience, so
// readSession (which refuses any token with an audience) can never take it for a session.
// No top-level calls: server/session.js and this file import each other.
import { SignJWT, jwtVerify } from 'jose'
import { cookie, parseCookies } from '../http.js'
import { secretKey } from '../session.js'

const VIEW_AS_COOKIE = 'xt_view_as'
const AUDIENCE = 'view-as'
const MAX_TOKEN = 4096
/** Owner decision O1: 30 minutes. One constant, so a different answer is a one-line change. */
const VIEW_AS_MINUTES = 30
const MAX_AGE_SECONDS = VIEW_AS_MINUTES * 60

/**
 * Seals a claim: { adminUid, adminJti, targetUid, targetGh, targetLogin, reason, vid }. `vid` is the start id (Task 16).
 * `now` (seconds) is for tests that need an expired claim.
 */
export function sealViewAs({ adminUid, adminJti, targetUid, targetGh, targetLogin, reason, vid }, now = Math.floor(Date.now() / 1000)) {
  return new SignJWT({
    admin_uid: adminUid,
    admin_jti: adminJti,
    target_uid: targetUid,
    target_gh: String(targetGh),
    target_login: targetLogin,
    reason,
    vid
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + MAX_AGE_SECONDS)
    .sign(secretKey())
}

/** The payload, or null when the token is missing, altered, expired or made for another audience. */
export async function openViewAs(token) {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN) return null
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'], audience: AUDIENCE })
    return payload
  } catch {
    return null
  }
}

/** The raw cookie value, or undefined. The only place the cookie is read from a request. */
export function viewAsCookieValue(request) {
  return parseCookies(request)[VIEW_AS_COOKIE]
}

/** The claim's lifetime in seconds, for the `expires_at` of the start row (#290). */
export const VIEW_AS_SECONDS = MAX_AGE_SECONDS

/** The Set-Cookie value that starts viewing: same attributes as the clearing one, so no cross-site request carries it. */
export function viewAsCookie(token) {
  return cookie(VIEW_AS_COOKIE, token, { maxAge: MAX_AGE_SECONDS, sameSite: 'Strict' })
}

/** Strict, so no cross-site request carries it. */
export function clearViewAsCookie() {
  return cookie(VIEW_AS_COOKIE, '', { maxAge: 0, sameSite: 'Strict' })
}
