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

// Characters a name can hide behind: format and default-ignorable characters (soft hyphen, zero-width space,
// tag characters, Hangul filler) and, only in the comparison key, combining marks.
const HIDDEN = /[\p{Default_Ignorable_Code_Point}\p{Cf}]/gu
const MARKS = /\p{M}/gu
const SPACES = /\p{White_Space}+/gu

/** The name as it is stored: NFKC, no hidden characters, one space per run of spaces, at most 60 characters. */
function storedName(clientName) {
  const plain = (cleanName(clientName ?? '') ?? '').normalize('NFKC').replace(HIDDEN, '').replace(SPACES, ' ').trim()
  return Array.from(plain).slice(0, CLIENT_NAME_MAX).join('').trim()
}

/** The key two names are compared on: the stored form without marks, lowercase. */
function foldKey(name) {
  return name.normalize('NFKC').replace(HIDDEN, '').replace(MARKS, '').replace(SPACES, ' ').trim().toLowerCase()
}

// A name that mixes Latin letters with Cyrillic or Greek letters can look like a reserved name (a Cyrillic е for a Latin e),
// so it is not shown as itself.
function mixesLookAlikeScripts(name) {
  return /\p{Script=Latin}/u.test(name) && /[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(name)
}

/** The name an OAuth client shows as, or 'App' when it is empty, mixes scripts, or is a reserved name after folding. */
function appName(clientName) {
  const name = storedName(clientName)
  const key = foldKey(name)
  if (name === '' || mixesLookAlikeScripts(name) || FIXED_ACTOR_NAMES.some((fixed) => foldKey(fixed) === key)) return 'App'
  return name
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
