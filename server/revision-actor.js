// Who made a draft change, as the history shows it (E273 task H3, #376). Every statement that writes drafts sets
// the one-shot columns drafts.last_actor_kind and last_actor_name from actorOf(caller) in the same statement; the
// trigger (db/migrations/015_draft_revisions.sql) reads them and clears them.
// Names are fixed constants or the client's own name, cleaned like server/admin/clean.js. Never user text, never a token.
import { cleanName } from './admin/clean.js'

export const LABEL_PUBLISHED = 'Published'
export const LABEL_COPIED = 'Copied from another draft'

// Names a client cannot take: a client named like one of these shows as 'App' instead, so no client can pose as the
// browser, a token, CI, an upload link or the import.
export const FIXED_ACTOR_NAMES = ['Editor', 'API token', 'CI', 'Upload link', 'Import', 'App']
const CLIENT_NAME_MAX = 60

/** The name an OAuth client shows as: cleaned, at most 60 characters, or 'App' when empty or reserved. */
function appName(clientName) {
  const cleaned = Array.from(cleanName(clientName ?? '') ?? '').slice(0, CLIENT_NAME_MAX).join('').trim()
  if (cleaned === '' || FIXED_ACTOR_NAMES.some((name) => name.toLowerCase() === cleaned.toLowerCase())) return 'App'
  return cleaned
}

/**
 * The actor of a draft write: `{ kind, name }`. Callers (server/session.js authenticate, server/mcp/rate.js,
 * server/oauth/tokens.js, server/routes/upload-links.js):
 * - a browser session (`via: 'session'`) is the user: `user`, `Editor`;
 * - an OAuth grant (`via: 'oauth'`, MCP or REST) is an app named by its client: `app`, the client's name;
 * - a personal API token (`via: 'token'`) is an app: `app`, `API token` (the token's own name is never used);
 * - a CI identity (`via: 'ci-oidc'`) is the system: `system`, `CI`;
 * - a one-time upload link (`uploadLink: true`, set only by server code) is an app: `app`, `Upload link`.
 * Any other caller throws, so a write never goes out without an actor.
 */
export function actorOf(caller) {
  if (caller?.uploadLink === true) return { kind: 'app', name: 'Upload link' }
  switch (caller?.via) {
    case 'session':
      return { kind: 'user', name: 'Editor' }
    case 'oauth':
      return { kind: 'app', name: appName(caller.clientName) }
    case 'token':
      return { kind: 'app', name: 'API token' }
    case 'ci-oidc':
      return { kind: 'system', name: 'CI' }
    default:
      throw new Error('draft write without a known caller')
  }
}
