import pg from 'pg'

let pool = null
let impl = null

/**
 * Runs one parameterised statement and resolves to `{ rows }`.
 * Uses a lazily created pool with a single connection per function instance.
 */
export async function query(text, params = []) {
  if (impl) return impl(text, params)
  if (!pool) {
    // Timeouts so a stalled connection fails in seconds instead of hanging the request.
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 8000,
      query_timeout: 15000
    })
  }
  return pool.query(text, params)
}

/** Tests only: replace the query implementation (e.g. PGlite). */
export function setQueryImpl(fn) {
  impl = fn
}
