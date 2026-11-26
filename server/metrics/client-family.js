// Observability plan O3 (#334): the client app family of an MCP call, the MCP part of the `caller`
// dimension in metrics_hourly. The list is fixed; the raw client_id is never stored or returned.
// A device client (kind 'device', from `device:<name>`) is the command line. A metadata client is
// matched by the host of its client_id URL; a registered client by the host of its redirect URIs.
// Hosts are matched exactly, and only over https. Grok has no host recorded yet (not checked), so
// nothing maps to mcp:grok until one is.
export const MCP_FAMILIES = ['mcp:claude', 'mcp:chatgpt', 'mcp:grok', 'mcp:cli', 'mcp:other']

const FAMILY_BY_HOST = new Map([
  ['claude.ai', 'mcp:claude'],
  ['chatgpt.com', 'mcp:chatgpt']
])

function httpsHost(url) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' ? parsed.hostname : null
  } catch {
    return null
  }
}

/**
 * The family of an OAuth client from its oauth_clients row: `kind`, `client_id` and `redirect_uris`.
 * Anything that matches no host is mcp:other.
 */
export function clientFamily({ kind, client_id: clientId, redirect_uris: redirectUris } = {}) {
  if (kind === 'device') return 'mcp:cli'
  const urls = kind === 'metadata' ? [clientId] : (redirectUris ?? [])
  for (const url of urls) {
    const family = FAMILY_BY_HOST.get(httpsHost(url))
    if (family) return family
  }
  return 'mcp:other'
}
