// The pairing code: shown once, in the owner's own browser, and typed back into the AI app (A5).
// Only its hash is stored, and the grant id is part of the hash, so a code never matches another connection.
import { randomInt } from 'node:crypto'
import { hashToken } from '../tokens.js'

export const PAIRING_MINUTES = 10
// Wrong guesses before the code is cancelled (plan A5, step 3).
export const PAIRING_TRIES = 3
// How long admin tools stay on for a connection after a right code (Needs from Shaked 2: default 24 hours).
export const ADMIN_ELEVATION_HOURS = 24

// No 0, O, 1, I or L: a code is read by eye and typed by hand.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** Eight characters from ALPHABET, picked with crypto.randomInt. */
export function newPairingCode() {
  let code = ''
  for (let i = 0; i < 8; i += 1) code += ALPHABET[randomInt(ALPHABET.length)]
  return code
}

/** `ABCD-EFGH`: a hyphen for reading only. It is never hashed. */
export function formatPairingCode(code) {
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

/** The stored hash: the grant id, a colon and the normalized code (case and hyphens ignored). */
export function pairingHash(grantId, code) {
  return hashToken(`${grantId}:${String(code).toUpperCase().replace(/[^A-Z0-9]/g, '')}`)
}
