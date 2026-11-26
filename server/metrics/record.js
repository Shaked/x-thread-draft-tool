// Observability plan O2 (#333): each request adds one row to the hourly rollup (metrics_hourly).
// A request that used no SQL (q = 0) is held in memory and written with the next request on this
// instance that does use the database, so a health check does not wake Neon. Best effort: pending
// rows are lost when the instance stops. Nothing here changes the answer of a request.
import { waitUntil } from '@vercel/functions'
import { query } from '../db.js'
import { merge, oneHot } from './histogram.js'
import { MCP_FAMILIES } from './client-family.js'

const CALLERS = new Set(['web', 'token', 'ci', 'anon', ...MCP_FAMILIES])
const COLUMNS = [
  'hour', 'route', 'op', 'caller', 'n', 'n_3xx', 'n_4xx', 'n_429', 'n_5xx', 'n_tool_error',
  'sum_ms', 'max_ms', 'sum_db_ms', 'sum_q', 'sum_conn', 'cold', 'buckets'
]
const SUMMED = ['n', 'n_3xx', 'n_4xx', 'n_429', 'n_5xx', 'n_tool_error', 'sum_ms', 'sum_db_ms', 'sum_q', 'sum_conn', 'cold']

const pending = new Map()
const inflight = new Set()

/** METRICS_DISABLED=1 turns the write off. Read on every request, so a test can change it. */
function metricsEnabled() {
  return process.env.METRICS_DISABLED !== '1'
}

function hourStart(now) {
  const d = new Date(now)
  d.setUTCMinutes(0, 0, 0)
  return d.toISOString()
}

// The op is a fixed name: an MCP method, or tool:<name> for a known tool. Anything else is 'other'.
function opOf(store) {
  if (store.rpc === 'tools/list') return 'tools/list'
  if (store.rpc === 'tools/call' && store.tool && store.tool !== 'list' && store.tool !== 'admin-list') return `tool:${store.tool}`
  if (store.rpc) return store.rpc
  return '-'
}

/** One row for this request, built from its store before any await, so nothing later changes it. */
export function rowOf(store, status, ms, now = Date.now()) {
  const rateLimited = status === 429 || store.rateLimited
  const clientError = (status >= 400 && status < 500 && status !== 429) || store.rpcError
  return {
    hour: hourStart(now),
    // Method and template (GET /drafts/:id), as the plan keys a row. An unmatched path has no method.
    route: store.route === 'unmatched' ? 'unmatched' : `${store.method} ${store.route}`,
    op: opOf(store),
    caller: CALLERS.has(store.caller) ? store.caller : 'anon',
    n: 1,
    n_3xx: status >= 300 && status < 400 ? 1 : 0,
    n_4xx: clientError ? 1 : 0,
    n_429: rateLimited ? 1 : 0,
    n_5xx: status >= 500 ? 1 : 0,
    n_tool_error: store.toolError ? 1 : 0,
    sum_ms: ms,
    max_ms: ms,
    sum_db_ms: store.dbMs,
    sum_q: store.q,
    sum_conn: store.conn,
    cold: store.cold ? 1 : 0,
    buckets: oneHot(ms)
  }
}

// Adds a row into a map keyed by its primary key, so one statement never names a key twice.
function addInto(map, row) {
  const key = [row.hour, row.route, row.op, row.caller].join('\u0000')
  const existing = map.get(key)
  if (!existing) {
    map.set(key, { ...row, buckets: [...row.buckets] })
    return
  }
  for (const column of SUMMED) existing[column] += row[column]
  existing.max_ms = Math.max(existing.max_ms, row.max_ms)
  existing.buckets = merge(existing.buckets, row.buckets)
}

function pgArray(values) {
  return `{${values.join(',')}}`
}

// One multi-row insert. Every right-hand side names its table: a bare column name is ambiguous in
// `on conflict do update` (checked in PGlite by the O1 tests).
async function writeRows(rows) {
  const params = []
  const tuples = rows.map((row) => {
    const marks = COLUMNS.map((column) => {
      params.push(column === 'buckets' ? pgArray(row.buckets) : row[column])
      return column === 'buckets' ? `$${params.length}::int[]` : `$${params.length}`
    })
    return `(${marks.join(', ')})`
  })
  const sets = SUMMED.map((c) => `${c} = metrics_hourly.${c} + excluded.${c}`)
  const text = `
    insert into metrics_hourly (${COLUMNS.join(', ')})
    values ${tuples.join(', ')}
    on conflict (hour, route, op, caller) do update set
      ${sets.join(',\n      ')},
      max_ms = greatest(metrics_hourly.max_ms, excluded.max_ms),
      buckets = array(
        select a + b from unnest(metrics_hourly.buckets, excluded.buckets) with ordinality as t(a, b, i) order by i
      )`
  await query(text, params)
}

/**
 * Records one request. A request with no SQL (store.q = 0) only goes to the pending rows. A request
 * that used the database writes its own row with the pending rows, in one statement. Resolves when
 * the write is done; it never rejects.
 */
function recordRequest(store, status, ms, now = Date.now()) {
  if (!metricsEnabled()) return Promise.resolve()
  const row = rowOf(store, status, ms, now)
  if (store.q === 0) {
    addInto(pending, row)
    return Promise.resolve()
  }
  const batch = new Map()
  for (const held of pending.values()) addInto(batch, held)
  pending.clear()
  addInto(batch, row)
  const write = writeRows([...batch.values()]).catch(() => {
    // Logged without the error: a message could hold request data. The answer is already sent.
    console.warn('[metrics] write failed')
  })
  inflight.add(write)
  write.then(() => inflight.delete(write))
  return write
}

/** Called after each answer. waitUntil keeps the write alive after the response on Vercel. */
export function afterRequest(store, status, ms) {
  const write = recordRequest(store, status, ms)
  try {
    waitUntil(write)
  } catch {
    // Outside Vercel waitUntil is not available. The write still runs; flushMetrics waits for it.
  }
}

/** Resolves when every write started so far has finished (tests and shutdown). */
export async function flushMetrics() {
  await Promise.all([...inflight])
}
