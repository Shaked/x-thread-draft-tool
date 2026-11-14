import pg from 'pg'
import { noteConnect, noteQuery } from './perf.js'

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

/** Times one statement for the [perf] line (perf.js). `fresh` means it opened a connection. */
async function counted(fresh, run) {
  const start = performance.now()
  try {
    return await run()
  } finally {
    noteQuery(performance.now() - start, fresh)
  }
}

/**
 * Runs one parameterised statement and resolves to `{ rows }`.
 * Uses a lazily created pool with a single connection per function instance.
 */
export async function query(text, params = []) {
  if (impl) return counted(false, () => impl(text, params))
  // Read before getPool(), which creates the pool: a pool with no idle client opens a new connection.
  const fresh = pool === null || pool.totalCount === 0
  return counted(fresh, () => getPool().query(text, params))
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
      const q = (text, params = []) => counted(false, () => impl(text, params))
      await q('BEGIN', [])
      try {
        const result = await fn(q)
        await q('COMMIT', [])
        return result
      } catch (err) {
        await q('ROLLBACK', []).catch(() => {})
        throw err
      }
    })
    implTail = run.catch(() => {})
    return run
  }
  // Read before connect(): an idle pool with no client opens a new connection (the cold path).
  const fresh = pool === null || pool.totalCount === 0
  const connectStart = performance.now()
  let client
  try {
    client = await getPool().connect()
  } finally {
    noteConnect(performance.now() - connectStart, fresh)
  }
  let broken = false
  try {
    await counted(false, () => client.query('BEGIN'))
    const result = await fn((text, params = []) => counted(false, () => client.query(text, params)))
    await counted(false, () => client.query('COMMIT'))
    return result
  } catch (err) {
    try {
      await counted(false, () => client.query('ROLLBACK'))
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
