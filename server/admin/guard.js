import { HttpError } from '../http.js'
import { currentCaller } from '../caller-context.js'
import { mcpAdminReason } from './role.js'
import { adminToolRouteKeys } from '../mcp/admin-tools.js'

const GUARDED = new WeakSet()

/** The app origin of this deployment (same rule as server/mcp/server.js). */
function appOrigin(request) {
  return (process.env.PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '')
}

/**
 * The one admin check. The caller must be an in-process MCP call (set by runAs, never read from the
 * network): an MCP OAuth connection of the admin identity (role.js decides that), running an admin tool.
 * With `routeKey` ("METHOD /admin/..."), the caller's admin tool must also list that route
 * (adminToolRouteKeys). Everything else is 404, the same answer as an unknown route.
 * Scope: this binding covers only callers that carry an `adminTool` (MCP today). The web admin surface
 * (#283) has no adminTool, so it must make its own per-route check there; it cannot rely on this one.
 */
function requireAdmin(request, routeKey) {
  const caller = currentCaller()
  const ok =
    caller !== null &&
    request.headers.get('authorization') === null &&
    mcpAdminReason(caller, appOrigin(request)) === null &&
    typeof caller.adminTool === 'string' &&
    caller.adminTool.startsWith('admin_') &&
    (routeKey === undefined || adminToolRouteKeys(caller.adminTool).includes(routeKey))
  if (!ok) throw new HttpError(404, 'Not found')
  return caller
}

/** The router's gate for `/admin` paths: true when the caller passes either check (each route checks again). */
export function adminPathOpen(request) {
  try {
    requireAdmin(request)
    return true
  } catch {
    return false
  }
}

/** The only way to make an admin route. The handler gets `admin`, the checked caller. */
export function adminRoute(method, path, handler) {
  if (!path.startsWith('/admin/')) throw new Error(`admin route outside /admin: ${path}`)
  const routeKey = `${method} ${path}`
  const guarded = async (ctx) => handler({ ...ctx, admin: requireAdmin(ctx.request, routeKey) })
  GUARDED.add(guarded)
  return { method, path, admin: true, handler: guarded }
}

export const isGuardedAdminHandler = (fn) => GUARDED.has(fn)
