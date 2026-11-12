// OAuth clients (plan Task 7.5). Two kinds can ask for access:
// - registered: Dynamic Client Registration (RFC 7591), client_id 'xtc_...'. Deprecated by the
//   MCP spec, kept for clients that do not support metadata documents.
// - metadata: Client ID Metadata Documents (draft-ietf-oauth-client-id-metadata-document), where
//   client_id is an https URL that serves the client's metadata. The spec's preferred method.
import { randomBytes } from 'node:crypto'
import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { query } from '../db.js'
import { isPrivateAddress } from '../remote-image.js'

const CLIENT_PREFIX = 'xtc_'
const MAX_REDIRECT_URIS = 5
const MAX_CLIENT_NAME = 100
const METADATA_MAX_BYTES = 10 * 1024
const METADATA_TIMEOUT_MS = 3000
const DAY_SECONDS = 24 * 60 * 60
const CLEANUP_BATCH = 100

let lookup = dnsLookup

/** Tests only: replace the DNS lookup so no network is needed. */
export function setMetadataResolverForTests(fn) {
  lookup = fn ?? dnsLookup
}

/**
 * Redirect URIs: https, or http on localhost or 127.0.0.1 (native and CLI clients), with no
 * fragment and no credentials. Matching is exact; see the authorize endpoint.
 */
function isValidRedirectUri(value) {
  if (typeof value !== 'string' || value.length > 2048 || value.includes('#')) return false
  let url
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.username || url.password) return false
  if (url.protocol === 'https:') return true
  return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
}

export function isValidRedirectUriList(value) {
  return Array.isArray(value) && value.length >= 1 && value.length <= MAX_REDIRECT_URIS && value.every(isValidRedirectUri)
}

/** A client_id that is an https URL with a path (the metadata document lives there). */
function isMetadataUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || value.includes('#')) return false
  let url
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return url.protocol === 'https:' && url.pathname.length > 1 && !url.username && !url.password
}

/** Stores a registered client and returns its client_id. Also deletes stale unused registrations. */
export async function registerClient({ client_name, redirect_uris }) {
  const clientId = CLIENT_PREFIX + randomBytes(16).toString('base64url')
  await query(
    `insert into oauth_clients (client_id, kind, client_name, redirect_uris) values ($1, 'registered', $2, $3)`,
    [clientId, client_name, redirect_uris]
  )
  await query(
    `delete from oauth_clients where client_id in (
       select c.client_id from oauth_clients c
        where c.kind = 'registered' and c.created_at < now() - interval '1 day'
          and not exists (select 1 from oauth_grants g where g.client_id = c.client_id)
        limit $1)`,
    [CLEANUP_BATCH]
  )
  return clientId
}

/**
 * Returns `{ client_id, kind, client_name, redirect_uris }` or null. Null means unknown,
 * unregistered, or a metadata document that could not be fetched or validated.
 */
export async function getClient(clientId) {
  if (typeof clientId !== 'string') return null
  if (clientId.startsWith(CLIENT_PREFIX)) {
    const { rows } = await query(
      `select client_id, kind, client_name, redirect_uris from oauth_clients
        where client_id = $1 and kind = 'registered'`,
      [clientId]
    )
    return rows[0] ?? null
  }
  if (isMetadataUrl(clientId)) return metadataClient(clientId)
  return null
}

async function metadataClient(clientId) {
  const { rows } = await query(
    `select client_id, kind, client_name, redirect_uris from oauth_clients
      where client_id = $1 and kind = 'metadata'
        and metadata_fetched_at > now() - make_interval(secs => $2)`,
    [clientId, DAY_SECONDS]
  )
  if (rows[0]) return rows[0]

  const fetched = await fetchMetadataDocument(clientId)
  if (!fetched) return null
  const { doc, ttl } = fetched
  // Cached until `ttl` seconds from now (at most 24 h). ttl 0 stores null, so the next request refetches.
  const { rows: stored } = await query(
    `insert into oauth_clients (client_id, kind, client_name, redirect_uris, metadata_fetched_at)
     values ($1, 'metadata', $2, $3, case when $4::boolean then now() - make_interval(secs => $5) else null end)
     on conflict (client_id) do update set
       client_name = excluded.client_name,
       redirect_uris = excluded.redirect_uris,
       metadata_fetched_at = excluded.metadata_fetched_at
     returning client_id, kind, client_name, redirect_uris`,
    [clientId, doc.client_name.trim(), doc.redirect_uris, ttl > 0, DAY_SECONDS - ttl]
  )
  return stored[0]
}

/** Cache lifetime in seconds from Cache-Control: no-store and no-cache mean 0, capped at 24 h. */
function cacheTtl(cacheControl) {
  const value = (cacheControl || '').toLowerCase()
  if (/\bno-store\b|\bno-cache\b/.test(value)) return 0
  const match = value.match(/max-age=(\d+)/)
  if (!match) return DAY_SECONDS
  return Math.min(Number(match[1]), DAY_SECONDS)
}

function isValidMetadataDocument(doc, clientId) {
  return (
    doc !== null &&
    typeof doc === 'object' &&
    !Array.isArray(doc) &&
    doc.client_id === clientId &&
    typeof doc.client_name === 'string' &&
    doc.client_name.trim().length >= 1 &&
    doc.client_name.trim().length <= MAX_CLIENT_NAME &&
    isValidRedirectUriList(doc.redirect_uris)
  )
}

async function readCapped(response, maxBytes) {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Fetches and validates a metadata document. https only, public addresses only (no redirects),
 * 3 s timeout, at most 10 KB, JSON, and its client_id must equal the URL exactly.
 */
async function fetchMetadataDocument(clientId) {
  const url = new URL(clientId)
  const hostname = url.hostname.replace(/^\[(.*)\]$/, '$1')
  let addresses
  try {
    addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true })
  } catch {
    return null
  }
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) return null

  let response
  try {
    response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
      headers: { accept: 'application/json' }
    })
  } catch {
    return null
  }
  if (!response.ok) return null // includes 3xx: redirects are not followed
  const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (type !== 'application/json') return null
  if (Number(response.headers.get('content-length') || 0) > METADATA_MAX_BYTES) return null

  let text
  try {
    text = await readCapped(response, METADATA_MAX_BYTES)
  } catch {
    return null
  }
  if (text === null) return null
  let doc
  try {
    doc = JSON.parse(text)
  } catch {
    return null
  }
  if (!isValidMetadataDocument(doc, clientId)) return null
  return { doc, ttl: cacheTtl(response.headers.get('cache-control')) }
}
