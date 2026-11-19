// The confirm token of an admin delete (plan A9). Built like sealDecision and openDecision in
// server/oauth/consent.js: HS256 with the session secret, 10 minutes, bound to its own audience.
// readSession refuses any token that has an audience, so this value can never be a session cookie.
import { SignJWT, jwtVerify } from 'jose'
import { secretKey } from '../session.js'

const AUDIENCE = 'admin-confirm'
const MAX_TOKEN = 4096

export function sealAdminConfirm(payload) {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(secretKey())
}

/** The payload, or null when the token is missing, altered, expired or made for another audience. */
export async function openAdminConfirm(token) {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN) return null
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'], audience: AUDIENCE })
    return payload
  } catch {
    return null
  }
}
