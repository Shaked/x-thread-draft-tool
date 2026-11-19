// The MCP views served as ui:// resources (plan Task 1, D2 to D4). Each view is one HTML document. Its URI carries
// a hash of the HTML, so a host that caches a view never pairs an old view with new data. T10 part 3 (#238): the
// environment's image origin is baked into each view's HTML, so the URI also changes with it. No user data is in a
// view; user data reaches a view only in a tool result.
import { createHash } from 'node:crypto'
import { THREAD_VIEW } from './thread.js'
import { DRAFTS_VIEW } from './drafts.js'
import { SHARE_VIEW } from './share.js'
import { blobOrigin, isBlobOrigin } from './origin.js'

const MIME_TYPE = 'text/html;profile=mcp-app'
const VIEWS = [THREAD_VIEW, DRAFTS_VIEW, SHARE_VIEW]
// Resolved once at load: the one image host the CSP allows, or no host when the store id is unknown.
const BLOB_ORIGIN = blobOrigin()

// The views for one image origin. The CSP and the URIs follow the origin, so a view and its CSP always match.
function entriesFor(imageOrigin) {
  const origin = isBlobOrigin(imageOrigin) ? imageOrigin : null
  const hosts = origin ? [origin] : []
  return VIEWS.map((view) => {
    const html = view.html(origin)
    const hash = createHash('sha256').update(html, 'utf8').digest('hex').slice(0, 12)
    const ui = { csp: { connectDomains: [], resourceDomains: hosts }, prefersBorder: true }
    // A view that needs a browser permission declares it in its own _meta.ui (plan D3); the host decides whether to grant it.
    return {
      uri: `ui://x-thread/${view.name}.html?v=${hash}`,
      name: view.name,
      title: view.title,
      description: view.description,
      mimeType: MIME_TYPE,
      size: Buffer.byteLength(html, 'utf8'),
      html,
      ui: view.permissions ? { ...ui, permissions: view.permissions } : ui,
      // ChatGPT reads its own widget keys (T10, #238), not _meta.ui: the same image host, in the snake_case form.
      widgetCsp: { connect_domains: [], resource_domains: hosts }
    }
  })
}

const ENTRIES = entriesFor(BLOB_ORIGIN)
const metaOf = (entry) => ({
  ui: structuredClone(entry.ui),
  'openai/widgetCSP': structuredClone(entry.widgetCsp),
  'openai/widgetPrefersBorder': true
})

/** resources/list entries for the views (no HTML in the list). */
export function listUiResources() {
  return ENTRIES.map((entry) => ({
    uri: entry.uri,
    name: entry.name,
    title: entry.title,
    description: entry.description,
    mimeType: entry.mimeType,
    size: entry.size,
    _meta: metaOf(entry)
  }))
}

/** resources/read contents for an exact view uri, or null when it is not a view (a wrong ?v= is not found). */
export function readUiResource(uri) {
  const entry = ENTRIES.find((e) => e.uri === uri)
  if (!entry) return null
  return [{ uri: entry.uri, mimeType: MIME_TYPE, text: entry.html, _meta: metaOf(entry) }]
}

/**
 * The public manifest for one image origin: the origin and, for each view, its uri, type, size and sha256 of its HTML.
 * No HTML. The smoke check rebuilds it from the origin the deployment reports, so a changed view fails the check.
 */
export function buildUiManifest(imageOrigin) {
  const origin = isBlobOrigin(imageOrigin) ? imageOrigin : null
  return {
    imageOrigin: origin,
    views: entriesFor(origin).map(({ uri, mimeType, size, html }) => ({
      uri,
      mimeType,
      sha256: createHash('sha256').update(html, 'utf8').digest('hex'),
      size
    }))
  }
}

/** The manifest for this environment (GET /api/mcp/ui-manifest). */
export function uiManifest() {
  return buildUiManifest(BLOB_ORIGIN)
}

/** The current uri of a view by name, or null. */
export function uiResourceUri(name) {
  return ENTRIES.find((e) => e.name === name)?.uri ?? null
}
