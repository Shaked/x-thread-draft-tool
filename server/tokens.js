import { createHash, randomBytes } from 'node:crypto'
import { query } from './db.js'
import { HttpError } from './http.js'

const TOKEN_SHAPE = /^xt_[A-Za-z0-9_-]{40,}$/
const MAX_ACTIVE_PER_USER = 20
/** SQL that is true for a token that is neither revoked nor expired. */
function activeSql(alias = '') {
  const a = alias ? `${alias}.` : ''
  return `(${a}revoked_at is null and (${a}expires_at is null or ${a}expires_at > now()))`
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

/** A new random token: `xt_` + 32 random bytes (base64url). Only the hash is kept. */
export function generateToken() {
  const token = `xt_${randomBytes(32).toString('base64url')}`
  return { token, hash: hashToken(token), prefix: token.slice(0, 10) }
}

export function isTokenShape(value) {
  return typeof value === 'string' && TOKEN_SHAPE.test(value)
}

/** Creates a token for `userId`. The plaintext is returned here and nowhere else. */
export async function createApiToken(userId, { name, expiresInDays = 90, via = 'web' } = {}) {
  const label = typeof name === 'string' ? name.trim() : ''
  if (label.length < 1 || label.length > 100) throw new HttpError(400, 'name must be 1 to 100 characters')
  if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365) {
    throw new HttpError(400, 'expires_in_days must be an integer from 1 to 365')
  }

  const active = await query(
    `select count(*)::int as n from api_tokens where user_id = $1 and ${activeSql()}`,
    [userId]
  )
  if (active.rows[0].n >= MAX_ACTIVE_PER_USER) {
    throw new HttpError(409, `You can have at most ${MAX_ACTIVE_PER_USER} active API tokens`)
  }

  const { token, hash, prefix } = generateToken()
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
  const { rows } = await query(
    `insert into api_tokens (user_id, name, token_hash, token_prefix, created_via, expires_at)
     values ($1, $2, $3, $4, $5, $6)
     returning id, name, token_prefix, expires_at`,
    [userId, label, hash, prefix, via, expiresAt]
  )
  const row = rows[0]
  return { token, id: row.id, name: row.name, prefix: row.token_prefix, expires_at: row.expires_at }
}

/**
 * Resolves a plaintext token to its owner. Returns null when unknown, expired or revoked.
 * Updates last_used_at at most once every five minutes.
 */
export async function findUserByToken(token) {
  if (!isTokenShape(token)) return null
  const { rows } = await query(
    `select u.id, u.github_id, u.login, t.id as token_id
       from api_tokens t join users u on u.id = t.user_id
      where t.token_hash = $1 and ${activeSql('t')}`,
    [hashToken(token)]
  )
  const row = rows[0]
  if (!row) return null
  await query(
    `update api_tokens set last_used_at = now()
      where id = $1 and (last_used_at is null or last_used_at < now() - interval '5 minutes')`,
    [row.token_id]
  )
  return { uid: row.id, gh: String(row.github_id), login: row.login, tokenId: row.token_id, via: 'token' }
}

/** Token rows for display. The hash is never selected. */
export async function listApiTokens(userId) {
  const { rows } = await query(
    `select id, name, token_prefix as prefix, created_via, created_at, last_used_at, expires_at, revoked_at
       from api_tokens where user_id = $1 order by created_at desc`,
    [userId]
  )
  return rows
}

/** Revokes one of the user's tokens. Returns false when it does not exist or is not theirs. */
export async function revokeApiToken(userId, id) {
  const { rowCount } = await query(
    'update api_tokens set revoked_at = now() where id = $1 and user_id = $2 and revoked_at is null',
    [id, userId]
  )
  return rowCount > 0
}
