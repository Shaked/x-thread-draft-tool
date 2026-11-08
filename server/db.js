import pg from 'pg'

let pool = null
let impl = null
// Tests (PGlite) have one connection, so their transactions are serialised here.
let implTail = Promise.resolve()

function getPool() {
  if (!pool) {
    // Timeouts so a stalled connection fails in seconds instead of hanging the request.
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 8000,
      query_timeout: 15000
    })
  }
  return pool
}

/**
 * Runs one parameterised statement and resolves to `{ rows }`.
 * Uses a lazily created pool with a single connection per function instance.
 */
export async function query(text, params = []) {
  if (impl) return impl(text, params)
  return getPool().query(text, params)
}

/**
 * Runs `fn` inside one BEGIN ... COMMIT. `fn` receives a `q(text, params)` function that
 * must be used for every statement in the transaction: the pool has one connection, so
 * calling `query()` inside `fn` would wait forever. If `fn` throws, the transaction is
 * rolled back and the error is rethrown. Resolves to whatever `fn` returns.
 */
export async function transaction(fn) {
  if (impl) {
    const run = implTail.then(async () => {
      await impl('BEGIN', [])
      try {
        const result = await fn(impl)
        await impl('COMMIT', [])
        return result
      } catch (err) {
        await impl('ROLLBACK', []).catch(() => {})
        throw err
      }
    })
    implTail = run.catch(() => {})
    return run
  }
  const client = await getPool().connect()
  let broken = false
  try {
    await client.query('BEGIN')
    const result = await fn((text, params = []) => client.query(text, params))
    await client.query('COMMIT')
    return result
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      broken = true
    }
    throw err
  } finally {
    client.release(broken || undefined)
  }
}

/** Tests only: replace the query implementation (e.g. PGlite). */
export function setQueryImpl(fn) {
  impl = fn
}
