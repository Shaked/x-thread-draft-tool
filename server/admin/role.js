// The one module that decides a role. Every admin decision point calls it (tests/api/admin-role-arch.test.js).
// Admin is decided by identity alone: the GitHub id (server/admin/identity.js), not the database and not a grant.
// The grant flag `admin` (server/mcp/rate.js) is checked only because it is part of the MCP caller; it never grants admin on its own.
import { isAdminGithubId } from './identity.js'

/** 'admin' or 'user' for a GitHub id. ADMIN_DISABLED=1 turns admin off (see identity.js). */
export function roleOf(githubId, env = process.env) {
  return isAdminGithubId(githubId, env) ? 'admin' : 'user'
}

/**
 * Why this MCP caller does not get the admin list: the FIRST failing condition by name, or null for the admin.
 * Order: via, resource, flag, disabled, gh. `flag` is always true on an MCP request (rate.js requires the MCP
 * resource), so admin is decided by identity alone (Shaked, 2026-11-20). The names are kept for the log line.
 * Names only, never a value (no id, token, login or address).
 */
export function mcpAdminReason(caller, origin) {
  if (caller?.via !== 'oauth') return 'via'
  if (caller.resource !== `${origin}/api/mcp`) return 'resource'
  if (caller.admin !== true) return 'flag'
  if (roleOf(caller.gh) === 'admin') return null
  return roleOf(caller.gh, { ...process.env, ADMIN_DISABLED: undefined }) === 'admin' ? 'disabled' : 'gh'
}
