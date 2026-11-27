// @vitest-environment node
// Every REST route is either called by an MCP tool or excluded on purpose (plan M4, G9). A route
// added to server/router.js without a tool or an exclusion fails this test.
import { describe, expect, it } from 'vitest'
import { ROUTES } from '../../server/router.js'
import { TOOL_REST_ROUTES } from '../../server/mcp/tools.js'
import { ADMIN_TOOL_REST_ROUTES, WEB_ONLY_ADMIN_ROUTES } from '../../server/mcp/admin-tools.js'

// Excluded routes. A key ending in "/*" matches that path and everything below it. A key with a
// method ("POST /images") matches only that method. Each has the reason it is not a tool.
const EXCLUDED = {
  '/auth/*': 'Sign-in and session (the connection signs in with GitHub on its own)',
  '/oauth/*': 'OAuth protocol endpoints',
  '/.well-known/*': 'OAuth metadata documents',
  '/tokens': 'S-5: a person creates and revokes credentials on the Settings page',
  '/tokens/:id': 'S-5: a person creates and revokes credentials on the Settings page',
  '/grants': 'S-5: a person disconnects apps on the Settings page',
  '/grants/:id': 'S-5: a person disconnects apps on the Settings page',
  'DELETE /images': '#412: the image edit tools delete the files in the same route; a REST client deletes one file by URL',
  'POST /images': 'D-5: raw image bytes are not sent through MCP (use add_image_from_url)',
  'GET /upload-links': '#418: the upload page reads its link; a tool makes the link, not the page',
  'POST /upload-links/images': '#418: raw bytes with the one-time link token, sent by the upload page; a tool makes the link, not the upload',
  'GET /drafts/:id/revisions': '#378 (H5): the MCP tools list_revisions, get_revision and restore_revision come in H7, #380',
  'GET /drafts/:id/revisions/:seq': '#378 (H5): the MCP tools come in H7, #380',
  'GET /share/:token': 'Public one-time read; the link is the product, not a tool',
  'GET /openapi.json': 'Documentation, not a user function',
  'GET /health': 'Health check, not a user function',
  'POST /ops/events': 'Metrics ingest from the metrics-daily workflow (GitHub OIDC), not a user function',
  'POST /ops/metrics-daily': 'Daily metrics step from the metrics-daily workflow (GitHub OIDC), not a user function',
  'GET /mcp/ui-manifest': 'Deploy check: view hashes for the production smoke step, not a user function',
  'POST /mcp': 'The MCP endpoint itself',
}

/** True when a route matches an EXCLUDED key. */
function matchesExclusion(route, key) {
  const [method, pattern] = key.includes(' ') ? key.split(' ') : [null, key]
  if (method !== null && method !== route.method) return false
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -1)
    return route.path.startsWith(prefix) || route.path === prefix.slice(0, -1)
  }
  return route.path === pattern
}

const routeKey = (route) => `${route.method} ${route.path}`

describe('REST routes and MCP tools', () => {
  it('every REST route is called by a tool or excluded on purpose', () => {
    const uncovered = ROUTES.filter(
      (route) =>
        !TOOL_REST_ROUTES.includes(routeKey(route)) &&
        !ADMIN_TOOL_REST_ROUTES.includes(routeKey(route)) &&
        !Object.hasOwn(WEB_ONLY_ADMIN_ROUTES, routeKey(route)) &&
        !Object.keys(EXCLUDED).some((key) => matchesExclusion(route, key))
    ).map(routeKey)
    expect(uncovered).toEqual([])
  })

  it('every exclusion names a route that still exists', () => {
    const stale = Object.keys(EXCLUDED).filter((key) => !ROUTES.some((route) => matchesExclusion(route, key)))
    expect(stale).toEqual([])
  })

  it('every REST route a tool calls exists in the router', () => {
    const known = new Set(ROUTES.map(routeKey))
    const missing = [...TOOL_REST_ROUTES, ...ADMIN_TOOL_REST_ROUTES].filter((key) => !known.has(key))
    expect(missing).toEqual([])
  })

  it('no admin route is excluded: every /admin route is an admin tool route', () => {
    const adminRoutes = ROUTES.filter((route) => route.path === '/admin' || route.path.startsWith('/admin/')).map(routeKey)
    expect(adminRoutes.length).toBeGreaterThan(0)
    // A route with no tool must be named in WEB_ONLY_ADMIN_ROUTES, each with a reason; nothing else passes (#290).
    expect(adminRoutes.filter((key) => !ADMIN_TOOL_REST_ROUTES.includes(key) && !Object.hasOwn(WEB_ONLY_ADMIN_ROUTES, key))).toEqual([])
    for (const [key, reason] of Object.entries(WEB_ONLY_ADMIN_ROUTES)) {
      expect(ADMIN_TOOL_REST_ROUTES, key).not.toContain(key)
      expect(adminRoutes, key).toContain(key)
      expect(reason.split(/\s+/).length, key).toBeGreaterThanOrEqual(3)
    }
    expect(Object.keys(EXCLUDED).filter((key) => key.includes('/admin'))).toEqual([])
  })

  it('admin tool routes are /admin paths with a method, and normal tools never call one', () => {
    for (const key of ADMIN_TOOL_REST_ROUTES) expect(key).toMatch(/^(GET|POST|PATCH|PUT|DELETE) \/admin\//)
    expect(TOOL_REST_ROUTES.filter((key) => key.includes('/admin'))).toEqual([])
  })
})
