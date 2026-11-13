// @vitest-environment node
// Every REST route is either called by an MCP tool or excluded on purpose (plan M4, G9). A route
// added to server/router.js without a tool or an exclusion fails this test.
import { describe, expect, it } from 'vitest'
import { ROUTES } from '../../server/router.js'
import { TOOL_REST_ROUTES } from '../../server/mcp/tools.js'

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
  'POST /images': 'D-5: raw image bytes are not sent through MCP (use add_image_from_url)',
  'GET /share/:token': 'Public one-time read; the link is the product, not a tool',
  'GET /openapi.json': 'Documentation, not a user function',
  'GET /health': 'Health check, not a user function',
  'POST /mcp': 'The MCP endpoint itself'
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
        !TOOL_REST_ROUTES.includes(routeKey(route)) && !Object.keys(EXCLUDED).some((key) => matchesExclusion(route, key))
    ).map(routeKey)
    expect(uncovered).toEqual([])
  })

  it('every exclusion names a route that still exists', () => {
    const stale = Object.keys(EXCLUDED).filter((key) => !ROUTES.some((route) => matchesExclusion(route, key)))
    expect(stale).toEqual([])
  })

  it('every REST route a tool calls exists in the router', () => {
    const known = new Set(ROUTES.map(routeKey))
    const missing = TOOL_REST_ROUTES.filter((key) => !known.has(key))
    expect(missing).toEqual([])
  })
})
