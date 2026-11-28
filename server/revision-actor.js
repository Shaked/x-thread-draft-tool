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

// Letters of other scripts that read as a Latin letter the reserved names use (a, c, d, e, i, k, m, n, o, p, t, u).
// They are folded only in the comparison key; the stored name keeps the characters the client sent. Escapes, so that a
// reviewer can see which code point each entry is: Cyrillic, Greek, Cherokee, Armenian, small capitals, dotless i.
const LOOK_ALIKE = new Map([
  ['\u0410', 'a'], ['\u0430', 'a'], ['\u0421', 'c'], ['\u0441', 'c'], ['\u0415', 'e'], ['\u0435', 'e'],
  ['\u0406', 'i'], ['\u0456', 'i'], ['\u041a', 'k'], ['\u043a', 'k'], ['\u041c', 'm'], ['\u043c', 'm'],
  ['\u041e', 'o'], ['\u043e', 'o'], ['\u0420', 'p'], ['\u0440', 'p'], ['\u0422', 't'], ['\u0442', 't'],
  ['\u0501', 'd'], ['\u0585', 'o'],
  ['\u0391', 'a'], ['\u03b1', 'a'], ['\u0395', 'e'], ['\u03b5', 'e'], ['\u0399', 'i'], ['\u03b9', 'i'],
  ['\u039a', 'k'], ['\u03ba', 'k'], ['\u039c', 'm'], ['\u03bc', 'm'], ['\u039f', 'o'], ['\u03bf', 'o'],
  ['\u03a1', 'p'], ['\u03c1', 'p'], ['\u03a4', 't'], ['\u03c4', 't'],
  ['\u13c6', 'i'], ['\u13df', 'c'],
  ['\u0131', 'i'], ['\u026a', 'i'], ['\u1d00', 'a'], ['\u1d04', 'c'], ['\u1d05', 'd'], ['\u1d07', 'e'],
  ['\u1d0d', 'm'], ['\u1d0f', 'o'], ['\u1d18', 'p'], ['\u1d1b', 't'], ['\u1d1c', 'u'],
])

/**
 * The key two names are compared on: decomposed (NFKD, so an accent is a separate mark and a fullwidth letter is ASCII),
 * then without hidden characters and marks, one space per run of spaces, look-alike letters read as Latin, lowercase.
 * A name whose key is empty (only marks, or only hidden characters) has nothing to compare, so it is 'App' (see appName).
 */
function foldKey(name) {
  const plain = name.normalize('NFKD').replace(HIDDEN, '').replace(MARKS, '').replace(SPACES, ' ').trim()
  return Array.from(plain, (ch) => LOOK_ALIKE.get(ch) ?? ch).join('').toLowerCase()
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
  if (name === '' || key === '' || mixesLookAlikeScripts(name) || FIXED_ACTOR_NAMES.some((fixed) => foldKey(fixed) === key)) return 'App'
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
