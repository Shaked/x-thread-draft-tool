// The MCP views served as ui:// resources (plan Task 1, D2 to D4). Each view is one HTML document. Its URI carries
// a hash of the HTML, so a host that caches a view never pairs an old view with new data. Nothing here depends
// on the user: the same HTML goes to everyone, and user data reaches a view only in a tool result.
import { createHash } from 'node:crypto'
import { THREAD_VIEW } from './thread.js'
import { blobOrigin } from './origin.js'

const MIME_TYPE = 'text/html;profile=mcp-app'
const VIEWS = [THREAD_VIEW]
// Resolved once at load: the one image host the CSP allows, or no host when the store id is unknown.
const BLOB_ORIGIN = blobOrigin()
const UI = {
  csp: { connectDomains: [], resourceDomains: BLOB_ORIGIN ? [BLOB_ORIGIN] : [] },
  prefersBorder: true
}

const ENTRIES = VIEWS.map((view) => {
  const hash = createHash('sha256').update(view.html, 'utf8').digest('hex').slice(0, 12)
  return {
    uri: `ui://x-thread/${view.name}.html?v=${hash}`,
    name: view.name,
    title: view.title,
    description: view.description,
    mimeType: MIME_TYPE,
    size: Buffer.byteLength(view.html, 'utf8'),
    html: view.html
  }
})

/** resources/list entries for the views (no HTML in the list). */
export function listUiResources() {
  return ENTRIES.map(({ html: _html, ...entry }) => ({ ...entry, _meta: { ui: UI } }))
}

/** resources/read contents for an exact view uri, or null when it is not a view (a wrong ?v= is not found). */
export function readUiResource(uri) {
  const entry = ENTRIES.find((e) => e.uri === uri)
  if (!entry) return null
  return [{ uri: entry.uri, mimeType: MIME_TYPE, text: entry.html, _meta: { ui: UI } }]
}

/** The current uri of a view by name, or null. */
export function uiResourceUri(name) {
  return ENTRIES.find((e) => e.name === name)?.uri ?? null
}
