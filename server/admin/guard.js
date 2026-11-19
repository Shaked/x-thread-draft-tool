import { HttpError } from '../http.js'
import { currentCaller } from '../caller-context.js'
import { isAdminGithubId } from './identity.js'

const GUARDED = new WeakSet()

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
export function requireAdmin(request) {
  const caller = currentCaller()
  const ok =
    caller !== null &&
    request.headers.get('authorization') === null &&
    caller.via === 'oauth' &&
    caller.resource === mcpResource(request) &&
    caller.admin === true &&
    typeof caller.adminTool === 'string' &&
    caller.adminTool.startsWith('admin_') &&
    isAdminGithubId(caller.gh)
  if (!ok) throw new HttpError(404, 'Not found')
  return caller
}

/** The only way to make an admin route. The handler gets `admin`, the checked caller. */
export function adminRoute(method, path, handler) {
  if (!path.startsWith('/admin/')) throw new Error(`admin route outside /admin: ${path}`)
  const guarded = async (ctx) => handler({ ...ctx, admin: requireAdmin(ctx.request) })
  GUARDED.add(guarded)
  return { method, path, admin: true, handler: guarded }
}

export const isGuardedAdminHandler = (fn) => GUARDED.has(fn)
