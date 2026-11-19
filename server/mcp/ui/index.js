// The MCP views served as ui:// resources (plan Task 1, D2 to D4). Each view is one HTML document. Its URI carries
// a hash of the HTML, so a host that caches a view never pairs an old view with new data. Nothing here depends
// on the user: the same HTML goes to everyone, and user data reaches a view only in a tool result.
import { createHash } from 'node:crypto'
import { THREAD_VIEW } from './thread.js'
import { DRAFTS_VIEW } from './drafts.js'
import { SHARE_VIEW } from './share.js'
import { blobOrigin } from './origin.js'

const MIME_TYPE = 'text/html;profile=mcp-app'
const VIEWS = [THREAD_VIEW, DRAFTS_VIEW, SHARE_VIEW]
// Resolved once at load: the one image host the CSP allows, or no host when the store id is unknown.
const BLOB_ORIGIN = blobOrigin()
const UI = {
  csp: { connectDomains: [], resourceDomains: BLOB_ORIGIN ? [BLOB_ORIGIN] : [] },
  prefersBorder: true
}
// A view that needs a browser permission declares it in its own _meta.ui (plan D3); the host decides whether to grant it.
const uiOf = (view) => (view.permissions ? { ...UI, permissions: view.permissions } : UI)

const ENTRIES = VIEWS.map((view) => {
  const hash = createHash('sha256').update(view.html, 'utf8').digest('hex').slice(0, 12)
  return {
    uri: `ui://x-thread/${view.name}.html?v=${hash}`,
    name: view.name,
    title: view.title,
    description: view.description,
    mimeType: MIME_TYPE,
    size: Buffer.byteLength(view.html, 'utf8'),
    html: view.html,
    ui: uiOf(view)
  }
})

// ChatGPT reads its own widget keys (T10, #238), not _meta.ui: the same one image host, in the snake_case form.
// Without it ChatGPT blocks the images in a view. Every view gets the same keys.
const WIDGET_CSP = { connect_domains: [], resource_domains: BLOB_ORIGIN ? [BLOB_ORIGIN] : [] }
const metaOf = (ui) => ({ ui: structuredClone(ui), 'openai/widgetCSP': structuredClone(WIDGET_CSP), 'openai/widgetPrefersBorder': true })

/** resources/list entries for the views (no HTML in the list). */
export function listUiResources() {
  return ENTRIES.map(({ html: _html, ui, ...entry }) => ({ ...entry, _meta: metaOf(ui) }))
}

/** resources/read contents for an exact view uri, or null when it is not a view (a wrong ?v= is not found). */
export function readUiResource(uri) {
  const entry = ENTRIES.find((e) => e.uri === uri)
  if (!entry) return null
  return [{ uri: entry.uri, mimeType: MIME_TYPE, text: entry.html, _meta: metaOf(entry.ui) }]
}

/** The public manifest (GET /api/mcp/ui-manifest): each view's uri, type, size and sha256 of its HTML. No HTML. */
export function uiManifest() {
  return {
    views: listUiResources().map(({ uri, mimeType, size }) => ({
      uri,
      mimeType,
      sha256: createHash('sha256').update(readUiResource(uri)[0].text, 'utf8').digest('hex'),
      size
    }))
  }
}

/** The current uri of a view by name, or null. */
export function uiResourceUri(name) {
  return ENTRIES.find((e) => e.name === name)?.uri ?? null
}
