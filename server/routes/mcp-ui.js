import { json } from '../http.js'
import { uiManifest } from '../mcp/ui/index.js'

/** GET /api/mcp/ui-manifest (public, no-store): the view uris and the sha256 of each view's HTML. No HTML, no user data. */
function uiManifestHandler() {
  return json(uiManifest())
}

export const mcpUiRoutes = [{ method: 'GET', path: '/mcp/ui-manifest', handler: uiManifestHandler }]
