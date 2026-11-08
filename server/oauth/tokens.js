import { randomBytes } from 'node:crypto'
import { query, transaction } from '../db.js'
import { hashToken } from '../tokens.js'

// OAuth tokens (plan Task 7.4). Opaque random strings; only their SHA-256 hashes are stored.
export const ACCESS_PREFIX = 'xta_'
export const REFRESH_PREFIX = 'xtr_'
export const SCOPE = 'drafts'
export const ACCESS_TTL_SECONDS = 60 * 60
const REFRESH_TTL_DAYS = 90
const CLEANUP_BATCH = 100

const ACCESS_SHAPE = /^xta_[A-Za-z0-9_-]{43}$/
const REFRESH_SHAPE = /^xtr_[A-Za-z0-9_-]{43}$/

/** An OAuth error with a protocol error code, such as `invalid_grant`. */
export class OAuthError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'OAuthError'
    this.code = code
    this.status = status
  }
}

function newToken(prefix) {
  const token = `${prefix}${randomBytes(32).toString('base64url')}`
  return { token, hash: hashToken(token) }
}

/** Inserts a new access + refresh pair for `grantId` through `q` and returns the plaintext pair. */
export async function insertPair(q, grantId) {
  const access = newToken(ACCESS_PREFIX)
  const refresh = newToken(REFRESH_PREFIX)
  await q(
    `insert into oauth_tokens (token_hash, grant_id, kind, expires_at) values
       ($1, $2, 'access', now() + make_interval(secs => $3)),
       ($4, $2, 'refresh', now() + make_interval(days => $5))`,
    [access.hash, grantId, ACCESS_TTL_SECONDS, refresh.hash, REFRESH_TTL_DAYS]
  )
  return {
    access_token: access.token,
    refresh_token: refresh.token,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_SECONDS,
    scope: SCOPE
  }
}

/**
 * Deletes up to 100 tokens that expired more than a day ago. Best effort: it runs after
 * the caller's token change has committed, and a failure is logged, never thrown. Re-running
 * it is harmless because it only deletes rows matching the expiry condition.
 */
export async function cleanupExpired() {
  try {
    await query(
      `delete from oauth_tokens where token_hash in (
         select token_hash from oauth_tokens
          where expires_at < now() - interval '1 day' limit $1)`,
      [CLEANUP_BATCH]
    )
  } catch (err) {
    console.error('[oauth] token cleanup failed', err)
  }
}

/**
 * Issues an access token (1 hour) and a rotating refresh token (90 days) for `grantId`.
 * The plaintext is returned here and nowhere else. Also deletes up to 100 tokens that
 * expired more than a day ago (best effort).
 */
export async function issuePair(grantId) {
  const pair = await insertPair(query, grantId)
  await cleanupExpired()
  return pair
}

const invalidGrant = () => new OAuthError('invalid_grant', 'The refresh token is invalid, expired or already used')

async function revokeGrant(grantId) {
  await query('update oauth_grants set revoked_at = now() where id = $1 and revoked_at is null', [grantId])
}

/**
 * Exchanges a refresh token for a new pair. The old refresh token is spent.
 * Throws OAuthError('invalid_grant') when the token is unknown, expired, belongs to another
 * client or a revoked grant (none of these spend it), or was already used. Using a spent
 * refresh token revokes the whole grant (reuse detection).
 */
export async function rotate(refreshToken, clientId) {
  if (typeof refreshToken !== 'string' || !REFRESH_SHAPE.test(refreshToken)) throw invalidGrant()
  const hash = hashToken(refreshToken)

  const { rows: found } = await query(
    `select t.grant_id, t.used_at, t.expires_at > now() as fresh, g.client_id, g.revoked_at
       from oauth_tokens t join oauth_grants g on g.id = t.grant_id
      where t.token_hash = $1 and t.kind = 'refresh'`,
    [hash]
  )
  const row = found[0]
  if (!row) throw invalidGrant()
  if (row.used_at) {
    await revokeGrant(row.grant_id)
    throw invalidGrant()
  }
  if (!row.fresh || row.revoked_at || row.client_id !== clientId) throw invalidGrant()

  // Spending the old token and issuing its replacement are one transaction: if any part
  // fails, the rollback leaves the old token unspent so the client can retry.
  // Of two concurrent rotations, only one can mark the token used.
  const pair = await transaction(async (q) => {
    const { rows: spent } = await q(
      `update oauth_tokens set used_at = now()
        where token_hash = $1 and kind = 'refresh' and used_at is null and expires_at > now()
        returning grant_id`,
      [hash]
    )
    if (!spent[0]) return null
    const issued = await insertPair(q, row.grant_id)
    await q('update oauth_grants set last_used_at = now() where id = $1', [row.grant_id])
    return issued
  })
  if (!pair) {
    // Lost the race: the token was spent by a concurrent request. Reuse, so revoke.
    await revokeGrant(row.grant_id)
    throw invalidGrant()
  }

  await cleanupExpired()
  return pair
}

/**
 * Resolves an access token for `expectedResource` (the audience it was issued for).
 * Returns `{ uid, gh, login, via: 'oauth', grantId }` or null when the token is unknown,
 * a refresh token, expired, for another resource, or its grant is revoked.
 */
export async function resolveAccess(token, expectedResource) {
  if (typeof token !== 'string' || !ACCESS_SHAPE.test(token)) return null
  const { rows } = await query(
    `select g.id as grant_id, u.id as uid, u.github_id, u.login
       from oauth_tokens t
       join oauth_grants g on g.id = t.grant_id
       join users u on u.id = g.user_id
      where t.token_hash = $1 and t.kind = 'access' and t.expires_at > now()
        and g.revoked_at is null and g.resource = $2`,
    [hashToken(token), expectedResource]
  )
  const row = rows[0]
  if (!row) return null
  return { uid: row.uid, gh: String(row.github_id), login: row.login, via: 'oauth', grantId: row.grant_id }
}
