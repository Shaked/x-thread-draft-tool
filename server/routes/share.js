import { query } from '../db.js'
import { extractTokenAndFormat, htmlResponse, renderHtml, renderMarkdown, textResponse } from '../share/render.js'

const EXPIRED_TEXT = 'This link has expired or was already used.'
const EXPIRED_HTML = `<h1>Link expired or invalid</h1><p>${EXPIRED_TEXT}</p>`

function gone(format) {
  return format === 'html' ? htmlResponse(EXPIRED_HTML, 410) : textResponse(`Link expired or invalid. ${EXPIRED_TEXT}`, 410)
}

/**
 * GET /api/share/:token[.md|.html] (public).
 * A link works only before expires_at (a row with none expires one hour after creation). A one-time
 * link is consumed in one atomic UPDATE, so it works exactly once even under concurrent requests.
 * A reusable link (one_time false) only records the read time.
 */
async function getShare({ url, path }) {
  const pathUrl = new URL(url.href)
  pathUrl.pathname = `/${path}`
  const { token, format } = extractTokenAndFormat(pathUrl)
  if (!token) {
    return format === 'html' ? htmlResponse('<h1>Invalid token</h1>', 400) : textResponse('Invalid token', 400)
  }

  const consumed = await query(
    `update share_tokens
        set used = case when one_time then true else used end,
            used_at = now()
      where token = $1
        and coalesce(expires_at, created_at + interval '1 hour') > now()
        and (one_time = false or used = false)
      returning draft_id`,
    [token]
  )
  if (!consumed.rows[0]) return gone(format)

  const { rows } = await query(
    `select d.title, d.posts, d.created_at,
            coalesce(u.name, u.login) as author_name,
            u.login as author_handle,
            u.avatar_url as author_avatar
       from drafts d
       left join users u on u.id = d.user_id
      where d.id = $1`,
    [consumed.rows[0].draft_id]
  )
  if (!rows[0]) return gone(format)

  const row = rows[0]
  const payload = {
    title: row.title || '',
    posts: row.posts || [],
    author_name: row.author_name || null,
    author_handle: row.author_handle || null,
    author_avatar: row.author_avatar || null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null
  }

  if (format === 'html') return htmlResponse(renderHtml(payload), 200)
  return textResponse(renderMarkdown(payload.title, payload.posts), 200)
}

export const shareRoutes = [{ method: 'GET', path: '/share/:token', handler: getShare }]
