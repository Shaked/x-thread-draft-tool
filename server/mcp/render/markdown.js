// Markdown text for AI apps that show no views (#293, Task 19): a table of drafts, an export in a fence, a share link.
// User text never goes in as raw markdown (GitHub-style clients auto-link a bare https://...): it goes in a fence, or
// (a draft title in a table cell) escaped. An auto-link inside a title can remain: the link text is the user's own, and
// a client may link it anyway.
import { stripForbidden } from '../language.js'
import { blobOrigin } from '../ui/origin.js'

/** The most characters of one markdown block. */
export const MARKDOWN_LIMIT = 8000
const TWEET = /^https:\/\/(x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d+$/
const SPECIAL = /[\\`*_[\]()#+\-!<>|]/g

/** A backtick run longer than any run in `text` (at least 3), so the text cannot close the fence. */
export function fenceFor(text) {
  const longest = Math.max(0, ...(String(text).match(/`+/g) || []).map((run) => run.length))
  return '`'.repeat(Math.max(3, longest + 1))
}

/** `text` in a fenced block (the text is left byte for byte as it is). */
export function fenced(text, lang = 'text') {
  const fence = fenceFor(text)
  return `${fence}${lang}\n${text}\n${fence}`
}

/** A title as one safe table cell: forbidden characters out, one line, every markdown mark escaped with a backslash. */
export function escapeCell(title) {
  const one = stripForbidden(String(title ?? '')).replace(/\s+/g, ' ').trim() || 'Untitled draft'
  return one.replace(SPECIAL, '\\$&')
}

/** A post image's link, only for our Blob origin; any other image is the plain word "image". */
export function imageLink(url, origin = blobOrigin()) {
  return typeof url === 'string' && origin && /^\S+$/.test(url) && url.startsWith(`${origin}/`) ? url : 'image'
}

/** A quoted tweet's link, only when it is a status url of x.com or twitter.com. */
export function tweetLink(url) {
  return typeof url === 'string' && TWEET.test(url) ? url : null
}

/** The drafts as a table (summaries or full drafts), with the editor link of each. */
export function draftsTable(drafts, origin) {
  if (!Array.isArray(drafts) || drafts.length === 0) return 'No drafts.'
  const rows = drafts.map((d) => {
    const posts = d.post_count ?? (Array.isArray(d.posts) ? d.posts.length : 0)
    const state = d.is_published ? 'published' : 'draft'
    const link = typeof d.id === 'string' && /^[0-9a-f-]+$/i.test(d.id) ? `${origin}/draft/${d.id}` : ''
    return `| ${escapeCell(d.title)} | ${posts} | ${state} | ${String(d.updated_at ?? '').slice(0, 10)} | ${link} |`
  })
  return capBlock(['| Title | Posts | State | Updated | Editor |', '| --- | --- | --- | --- | --- |', ...rows], drafts.length, `${origin}/`)
}

/** Table lines under the limit; a longer table ends with "... n more drafts: <editor url>". */
function capBlock(lines, total, editor) {
  const out = []
  let size = 0
  for (const line of lines) {
    if (size + line.length + 1 > MARKDOWN_LIMIT - 120) break
    out.push(line)
    size += line.length + 1
  }
  const shown = out.length - 2
  return shown >= total ? out.join('\n') : `${out.join('\n')}\n\n... ${total - shown} more drafts: ${editor}`
}

/** An export (json, text or formatted) as one fenced block, cut to the limit with a note. */
export function exportBlock(text, format) {
  const body = String(text ?? '')
  const room = MARKDOWN_LIMIT - 200
  const cut = Array.from(body).length > room ? `${Array.from(body).slice(0, room).join('')}\n...` : body
  return fenced(cut, format === 'json' ? 'json' : 'text')
}

/** A share link and when it stops working. */
export function shareLine({ preview_url: preview, markdown_url: markdown, expires_at: expires, one_time: oneTime }) {
  const when = expires ? `expires ${expires}` : 'no expiry'
  return [`Share link (${oneTime ? 'works once, ' : ''}${when}):`, `- Preview: ${preview}`, `- Markdown: ${markdown}`].join('\n')
}
