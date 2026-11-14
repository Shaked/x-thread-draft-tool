// Request timing and query counts (plan P1, docs/plans/performance.md). One `[perf]` log line per
// request and a `server-timing` header. The log holds the route TEMPLATE only (`/share/:token`),
// never a real path, id, token, header, body or query string.
import { AsyncLocalStorage } from 'node:async_hooks'

const als = new AsyncLocalStorage()
// Only these MCP methods reach the log; anything else a client sends is logged as 'other'.
const RPC_METHODS = new Set([
  'initialize',
  'notifications/initialized',
  'ping',
  'tools/list',
  'tools/call',
  'prompts/list',
  'prompts/get',
  'resources/list',
  'resources/read',
  'resources/templates/list'
])
let cold = true

const round = (n) => Math.round(n * 10) / 10
const current = () => als.getStore() ?? null

/** Wraps a route handler. A nested in-process call (an MCP tool) joins the outer request's store. */
export function measured(fn) {
  return async (request) => {
    if (current()) return fn(request)
    const wasCold = cold
    cold = false
    const store = { route: 'unmatched', q: 0, dbMs: 0, conn: 0, rpc: null, tool: null }
    const start = performance.now()
    const response = await als.run(store, () => fn(request))
    const total = performance.now() - start
    try {
      response.headers.set(
        'server-timing',
        `total;dur=${round(total)}, db;dur=${round(store.dbMs)}, q;desc="${store.q}", ` +
          `conn;desc="${store.conn}", cold;desc="${wasCold ? 1 : 0}"`
      )
    } catch {
      // Some Response objects have immutable headers: such an answer has no timing header.
    }
    // The one informational log on the server: the no-console rule allows only error and warn.
    // eslint-disable-next-line no-console
    console.log(
      '[perf] ' +
        JSON.stringify({
          m: request.method,
          p: store.route,
          s: response.status,
          ms: round(total),
          q: store.q,
          db: round(store.dbMs),
          conn: store.conn,
          cold: wasCold ? 1 : 0,
          region: process.env.VERCEL_REGION ?? null,
          rpc: store.rpc,
          tool: store.tool
        })
    )
    return response
  }
}

/** The matched route template, e.g. `/drafts/:id`. The first one set in a request wins (the outer one). */
export function setRoute(template) {
  const store = current()
  if (store && store.route === 'unmatched') store.route = template
}

/** One SQL statement: counts a round trip. `fresh` means a new connection was opened for it. */
export function noteQuery(ms, fresh) {
  const store = current()
  if (!store) return
  store.q += 1
  store.dbMs += ms
  if (fresh) store.conn += 1
}

/** Time spent opening a connection. It is not a statement, so it does not count in `q`. */
export function noteConnect(ms, fresh) {
  const store = current()
  if (!store) return
  store.dbMs += ms
  if (fresh) store.conn += 1
}

/** The JSON-RPC method and, for tools/call, the tool name (the caller passes null for an unknown name). */
export function noteRpc(method, tool) {
  const store = current()
  if (!store) return
  store.rpc = RPC_METHODS.has(method) ? method : 'other'
  store.tool = tool ?? null
}
