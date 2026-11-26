import { HttpError } from '../http.js'
import { currentCaller } from '../caller-context.js'
import { authenticate, realSession } from '../session.js'
import { mcpAdminReason, roleOf } from './role.js'
import { adminToolRouteKeys } from '../mcp/admin-tools.js'
import { RATE_LIMIT_MESSAGE, withinToolRate } from '../mcp/rate.js'

/**
 * Admin-only content for a REST caller (the changelog, #368): a signed-in caller whose GitHub id role.js
 * calls admin. Everyone else, signed out included, gets the answer of an unknown path (404, same body).
 */
export async function requireAdminUser(request) {
  let caller = null
  try {
    caller = await authenticate(request)
  } catch {
    caller = null
  }
  if (!caller || roleOf(caller.gh) !== 'admin') throw new HttpError(404, 'Not found')
  return caller
}

/** The `admin: true` field of GET /api/auth/me: present only for the admin, so no other caller sees it. */
export function adminField(caller) {
  return roleOf(caller.gh) === 'admin' ? { admin: true } : {}
}

const GUARDED = new WeakSet()

// A web admin change (any method but GET) needs a browser sign-in from this window. Owner decision (#552, 2026-11-26):
// 7 days, not the 12 hours of #284, because a short window made the owner sign in again in the middle of a flag change.
// Reads are not limited, and MCP has no such rule (Shaked, 2026-11-20). `iat` is the sign-in time: sessions are issued only at sign-in.
// An old sign-in answers 403 with the code `sign_in_again`; the browser opens the sign-in pop-up and repeats the call once.
const WEB_WRITE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60
const SIGN_IN_AGAIN_CODE = 'sign_in_again'

function signedInRecently(admin) {
  return typeof admin.iat === 'number' && Date.now() / 1000 - admin.iat <= WEB_WRITE_MAX_AGE_SECONDS
}

/** The app origin of this deployment (same rule as server/mcp/server.js). */
function appOrigin(request) {
  return (process.env.PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '')
}

/**
 * The one admin check. Two surfaces; everything else is 404, the same answer as an unknown route.
 * `mcp`: an in-process MCP call (set by runAs, never read from the network): an OAuth connection of the admin identity
 * (role.js decides that), running an admin tool. With `routeKey` ("METHOD /admin/..."), that tool must list the route
 * (adminToolRouteKeys). This binding applies to the MCP surface only: the web surface has no adminTool.
 * `web`: the owner's browser session with the header `x-xt-admin: 1` (realSession, server/session.js).
 * Async: callers must await it. A Promise left unawaited would be truthy, so the gate would open for everyone.
 * Returns `{ ...caller, surface }`, with `jti` on web and `grantId` on MCP.
 */
async function requireAdmin(request, routeKey) {
  const caller = currentCaller()
  if (caller !== null) {
    const ok =
      request.headers.get('authorization') === null &&
      mcpAdminReason(caller, appOrigin(request)) === null &&
      typeof caller.adminTool === 'string' &&
      caller.adminTool.startsWith('admin_') &&
      (routeKey === undefined || adminToolRouteKeys(caller.adminTool).includes(routeKey))
    if (!ok) throw new HttpError(404, 'Not found')
    return { ...caller, surface: 'mcp', grantId: caller.grantId }
  }
  const session = await realSession(request)
  if (session === null) throw new HttpError(404, 'Not found')
  return { ...session, surface: 'web', jti: session.jti }
}

/** The router's gate for `/admin` paths: true when the caller passes either check (each route checks again). Never counts. */
export async function adminPathOpen(request) {
  try {
    await requireAdmin(request)
    return true
  } catch {
    return false
  }
}

/** The only way to make an admin route. The handler gets `admin`, the checked caller. */
export function adminRoute(method, path, handler) {
  if (!path.startsWith('/admin/')) throw new Error(`admin route outside /admin: ${path}`)
  const routeKey = `${method} ${path}`
  const guarded = async (ctx) => {
    const admin = await requireAdmin(ctx.request, routeKey)
    if (admin.surface === 'web' && method !== 'GET' && !signedInRecently(admin)) {
      throw new HttpError(403, `Sign in again: admin changes on the web need a sign-in from the last ${WEB_WRITE_MAX_AGE_SECONDS / 86400} days.`, SIGN_IN_AGAIN_CODE)
    }
    // A web call counts once, in the same per-minute row as an MCP admin tool call (the MCP surface counts in server/mcp/server.js).
    if (admin.surface === 'web' && !(await withinToolRate(admin.uid))) throw new HttpError(429, RATE_LIMIT_MESSAGE)
    return handler({ ...ctx, admin })
  }
  GUARDED.add(guarded)
  return { method, path, admin: true, handler: guarded }
}

export const isGuardedAdminHandler = (fn) => GUARDED.has(fn)
