// Text from users, shown to the owner in admin reads (plan A7). Control characters, lone surrogates and the
// bidi and invisible characters of server/mcp/language.js are removed; the result is cut to 80 characters.
import { stripForbidden } from '../mcp/language.js'

const MAX_NAME = 80
const LOGIN_SHAPE = /^[A-Za-z0-9-]{1,39}$/
// A lone surrogate: a high one not followed by a low one, or a low one not preceded by a high one.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/** A display name without control, bidi or invisible characters, at most 80 characters. Null for a non-string. */
export function cleanName(value) {
  if (typeof value !== 'string') return null
  const plain = stripForbidden(value.normalize('NFC').replace(/\p{Cc}/gu, '').replace(LONE_SURROGATE, ''))
  return Array.from(plain).slice(0, MAX_NAME).join('')
}

/** A GitHub login as it is, when it has the login shape; otherwise a fixed placeholder. */
export function cleanLogin(value) {
  return typeof value === 'string' && LOGIN_SHAPE.test(value) ? value : '(invalid login)'
}
