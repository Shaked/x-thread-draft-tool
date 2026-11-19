import { HttpError } from '../http.js'
import { currentCaller } from '../caller-context.js'
import { isAdminGithubId } from './identity.js'

const GUARDED = new WeakSet()
// The one tool a pending connection may call (plan A5).
export const PENDING_TOOL = 'admin_activate'

/** The MCP resource of this deployment, `<origin>/api/mcp` (same rule as server/mcp/server.js). */
function mcpResource(request) {
  const origin = (process.env.PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '')
  return `${origin}/api/mcp`
}

/**
 * The one admin check. The caller must be an in-process MCP call (set by runAs, never read from the
 * network) of an OAuth token for the MCP resource on an elevated grant, running an admin tool, and
 * the user's GitHub id must be an admin id. Everything else is 404, the same answer as an unknown route.
 */
function requireAdmin(request, { pending = false } = {}) {
  const caller = currentCaller()
  const base =
    caller !== null &&
    request.headers.get('authorization') === null &&
    caller.via === 'oauth' &&
    caller.resource === mcpResource(request) &&
    isAdminGithubId(caller.gh)
  // A pending connection (a pairing code waiting) may call only the activation tool, and only that route.
  const ok = base && (pending
    ? caller.adminPending === true && caller.adminTool === PENDING_TOOL
    : caller.admin === true && typeof caller.adminTool === 'string' && caller.adminTool.startsWith('admin_') && caller.adminTool !== PENDING_TOOL)
  if (!ok) throw new HttpError(404, 'Not found')
  return caller
}

/** The router's gate for `/admin` paths: true when the caller passes either check (each route checks again). */
export function adminPathOpen(request) {
  for (const options of [{}, { pending: true }]) {
    try {
      requireAdmin(request, options)
      return true
    } catch {
      // Not this kind of admin caller: try the next check.
    }
  }
  return false
}

/** The only way to make an admin route. The handler gets `admin`, the checked caller. */
export function adminRoute(method, path, handler, { pending = false } = {}) {
  if (!path.startsWith('/admin/')) throw new Error(`admin route outside /admin: ${path}`)
  const guarded = async (ctx) => handler({ ...ctx, admin: requireAdmin(ctx.request, { pending }) })
  GUARDED.add(guarded)
  return { method, path, admin: true, pending, handler: guarded }
}

export const isGuardedAdminHandler = (fn) => GUARDED.has(fn)
