// Edge Function: GET /functions/v1/share/<token>.<ext>
// Consumes a one-time share token and returns the draft. Supports two
// formats selected by the URL extension:
//   .md   -> markdown payload for agents
//   .html -> self-contained HTML page styled like an X.com thread

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Format = 'md' | 'html'

type ImageEntry = string | { url?: string }

type Post = {
  id?: string
  text?: string
  images?: ImageEntry[]
  embeddedTweet?: string | null
}

type Payload = {
  title: string
  posts: Post[]
  author_name: string | null
  author_handle: string | null
  author_avatar: string | null
  created_at: string | null
}

function response(body: string, contentType: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': `${contentType}; charset=utf-8`,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex'
    }
  })
}

function textResponse(body: string, status = 200) {
  return response(body, 'text/markdown', status)
}

function htmlResponse(body: string, status = 200) {
  return response(body, 'text/html', status)
}

function extractTokenAndFormat(url: URL): { token: string | null; format: Format } {
  const parts = url.pathname.split('/').filter(Boolean)
  let last = parts[parts.length - 1] || ''
  let format: Format = 'md'
  if (last.endsWith('.html')) {
    format = 'html'
    last = last.slice(0, -5)
  } else if (last.endsWith('.md')) {
    format = 'md'
    last = last.slice(0, -3)
  }
  return { token: UUID_RE.test(last) ? last : null, format }
}

function imageUrl(img: ImageEntry): string | null {
  if (!img) return null
  if (typeof img === 'string') return img
  return img.url || null
}

function renderMarkdown(title: string, posts: Post[]): string {
  const total = posts.length
  let md = `# ${title || 'Thread'}\n\n`

  posts.forEach((post, i) => {
    md += `## ${i + 1}/${total}\n\n`
    md += `${post.text || ''}\n\n`

    const images = post.images || []
    if (images.length > 0) {
      images.forEach((img, idx) => {
        const url = imageUrl(img)
        if (url) md += `![Image ${idx + 1}](${url})\n`
      })
      md += '\n'
    }

    if (post.embeddedTweet) md += `> Embedded tweet: ${post.embeddedTweet}\n\n`
  })

  return md
}

const RTL_RE = /[\u0591-\u07FF\u200F\u202B\u202E\uFB1D-\uFDFD\uFE70-\uFEFC]/

function isRTL(text: string): boolean {
  return RTL_RE.test(text)
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const URL_RE = /(https?:\/\/[^\s<]+)/g

function linkify(escaped: string): string {
  return escaped.replace(URL_RE, (m) => {
    const trimmed = m.replace(/[.,;:!?)\]]+$/, '')
    const trail = m.slice(trimmed.length)
    return `<a class="x-link" href="${trimmed}" target="_blank" rel="noopener noreferrer">${trimmed}</a>${trail}`
  })
}

function renderText(text: string): string {
  if (!text) return ''
  return linkify(htmlEscape(text)).replace(/\n/g, '<br>')
}

function formatTime(d: Date): string {
  const h = d.getHours()
  const m = d.getMinutes().toString().padStart(2, '0')
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour12 = ((h + 11) % 12) + 1
  return `${hour12}:${m} ${ampm}`
}

function formatDate(d: Date): string {
  const day = d.getDate().toString().padStart(2, '0')
  const month = (d.getMonth() + 1).toString().padStart(2, '0')
  const year = d.getFullYear()
  return `${day}/${month}/${year}`
}

function tweetIdFrom(url: string): string | null {
  const m = url.match(/status\/(\d+)/)
  return m ? m[1] : null
}

function renderImages(images: ImageEntry[]): string {
  const urls = images.map(imageUrl).filter((u): u is string => !!u)
  if (urls.length === 0) return ''

  const layout = urls.length === 1 ? 'one' : urls.length === 2 ? 'two' : urls.length === 3 ? 'three' : 'four'
  const items = urls
    .map(
      (u, i) =>
        `<a class="x-media-item" href="${htmlEscape(u)}" target="_blank" rel="noopener noreferrer">` +
        `<img src="${htmlEscape(u)}" alt="Image ${i + 1}" loading="lazy" decoding="async">` +
        `</a>`
    )
    .join('')

  return `<div class="x-media x-media-${layout}">${items}</div>`
}

function renderEmbed(url: string): string {
  const safeUrl = htmlEscape(url)
  const id = tweetIdFrom(url)
  if (!id) {
    return `<div class="x-embed x-embed-fallback"><a class="x-link" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl}</a></div>`
  }
  return (
    `<div class="x-embed">` +
    `<blockquote class="twitter-tweet" data-theme="dark" data-conversation="none" data-dnt="true">` +
    `<a href="${safeUrl}"></a>` +
    `</blockquote>` +
    `</div>`
  )
}

function actionBar(): string {
  return `
    <div class="x-actions" aria-hidden="true">
      <span class="x-action">
        <svg viewBox="0 0 24 24" width="18" height="18"><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z"/></svg>
        <span>Reply</span>
      </span>
      <span class="x-action">
        <svg viewBox="0 0 24 24" width="18" height="18"><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z"/></svg>
        <span>Repost</span>
      </span>
      <span class="x-action">
        <svg viewBox="0 0 24 24" width="18" height="18"><path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z"/></svg>
        <span>Like</span>
      </span>
      <span class="x-action">
        <svg viewBox="0 0 24 24" width="18" height="18"><path d="M8.75 21V3h2v18h-2zM18 21V8.5h2V21h-2zM4 21l.004-10h2L6 21H4zm9.248 0v-7h2v7h-2z"/></svg>
        <span>Views</span>
      </span>
      <span class="x-action x-action-end">
        <svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5zM6.5 4c-.276 0-.5.22-.5.5v14.56l6-4.29 6 4.29V4.5c0-.28-.224-.5-.5-.5h-11z"/></svg>
      </span>
      <span class="x-action">
        <svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z"/></svg>
      </span>
    </div>
  `
}

function avatarHtml(name: string, avatar: string | null): string {
  if (avatar) {
    return `<img class="x-avatar" src="${htmlEscape(avatar)}" alt="${htmlEscape(name)}" loading="lazy">`
  }
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?'
  return `<div class="x-avatar x-avatar-fallback">${htmlEscape(initial)}</div>`
}

function verifiedBadge(): string {
  return `<svg class="x-verified" viewBox="0 0 22 22" width="18" height="18" aria-label="Verified"><path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"/></svg>`
}

function renderHtml(payload: Payload): string {
  const title = payload.title || 'Thread'
  const posts = payload.posts || []
  const authorName = payload.author_name || 'Author'
  const authorHandle = payload.author_handle || 'author'
  const created = payload.created_at ? new Date(payload.created_at) : new Date()
  const timeStr = formatTime(created)
  const dateStr = formatDate(created)
  const avatarMarkup = avatarHtml(authorName, payload.author_avatar)

  const hasEmbed = posts.some((p) => !!p.embeddedTweet)

  const postsHtml = posts
    .map((post, i) => {
      const text = post.text || ''
      const dir = isRTL(text) ? 'rtl' : 'ltr'
      const images = renderImages(post.images || [])
      const embed = post.embeddedTweet ? renderEmbed(post.embeddedTweet) : ''
      const isLast = i === posts.length - 1

      return `
        <article class="x-post${isLast ? ' x-post-last' : ''}" dir="${dir}">
          <div class="x-post-left">
            ${avatarMarkup}
            ${isLast ? '' : '<div class="x-thread-line"></div>'}
          </div>
          <div class="x-post-body">
            <header class="x-post-head">
              <span class="x-name">${htmlEscape(authorName)}</span>
              ${verifiedBadge()}
              <span class="x-meta">@${htmlEscape(authorHandle)} · ${dateStr}</span>
            </header>
            <div class="x-text" dir="${dir}">${renderText(text)}</div>
            ${images}
            ${embed}
            ${actionBar()}
          </div>
        </article>
      `
    })
    .join('')

  const widgetScript = hasEmbed
    ? '<script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>'
    : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${htmlEscape(title)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #000; color: #e7e9ea; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
  a { color: #1d9bf0; text-decoration: none; }
  a:hover { text-decoration: underline; }

  .x-app { max-width: 600px; margin: 0 auto; border-left: 1px solid #2f3336; border-right: 1px solid #2f3336; min-height: 100vh; }
  .x-header { position: sticky; top: 0; z-index: 10; backdrop-filter: blur(12px); background: rgba(0,0,0,0.65); border-bottom: 1px solid #2f3336; padding: 14px 16px; display: flex; align-items: center; gap: 28px; }
  .x-back { color: #e7e9ea; font-size: 20px; line-height: 1; padding: 6px 8px; border-radius: 999px; }
  .x-back:hover { background: #181818; text-decoration: none; }
  .x-header-title { font-size: 20px; font-weight: 800; }

  .x-thread { display: flex; flex-direction: column; }

  .x-post { display: grid; grid-template-columns: 56px 1fr; padding: 12px 16px 4px; border-bottom: 1px solid #2f3336; }
  .x-post-last { border-bottom: 1px solid #2f3336; padding-bottom: 12px; }

  .x-post-left { display: flex; flex-direction: column; align-items: center; }
  .x-avatar { width: 40px; height: 40px; border-radius: 50%; background: #16181c; object-fit: cover; }
  .x-avatar-fallback { display: flex; align-items: center; justify-content: center; color: #71767b; font-weight: 700; font-size: 18px; border: 1px solid #2f3336; }
  .x-thread-line { flex: 1; width: 2px; background: #2f3336; margin-top: 6px; min-height: 12px; }

  .x-post-body { min-width: 0; padding-bottom: 4px; }
  .x-post-head { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; line-height: 1.2; padding: 2px 0 2px; }
  .x-name { font-weight: 700; color: #e7e9ea; }
  .x-verified { fill: #1d9bf0; flex-shrink: 0; }
  .x-meta { color: #71767b; font-size: 15px; }

  .x-text { font-size: 17px; line-height: 1.4; color: #e7e9ea; white-space: pre-wrap; word-wrap: break-word; padding: 4px 0 8px; }
  .x-text[dir="rtl"] { text-align: right; }

  .x-link { color: #1d9bf0; }

  .x-media { display: grid; gap: 2px; margin: 4px 0 12px; border-radius: 16px; overflow: hidden; border: 1px solid #2f3336; }
  .x-media-one { grid-template-columns: 1fr; }
  .x-media-two { grid-template-columns: 1fr 1fr; }
  .x-media-three { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
  .x-media-three .x-media-item:first-child { grid-row: span 2; }
  .x-media-four { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
  .x-media-item { display: block; overflow: hidden; background: #16181c; aspect-ratio: 16/10; }
  .x-media-one .x-media-item { aspect-ratio: auto; max-height: 510px; }
  .x-media-item img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .x-media-one .x-media-item img { object-fit: contain; max-height: 510px; }

  .x-embed { margin: 4px 0 12px; }
  .x-embed-fallback { padding: 12px; border: 1px solid #2f3336; border-radius: 16px; word-break: break-all; }
  .x-embed .twitter-tweet { margin: 0 !important; }

  .x-actions { display: flex; align-items: center; gap: 0; margin-top: 8px; max-width: 425px; color: #71767b; }
  .x-action { display: inline-flex; align-items: center; gap: 6px; flex: 1; font-size: 13px; cursor: default; padding: 4px 0; }
  .x-action-end { flex: 0 0 auto; margin-left: auto; }
  .x-action svg { fill: currentColor; }

  @media (max-width: 640px) {
    .x-app { border-left: none; border-right: none; }
    .x-text { font-size: 16px; }
  }
</style>
</head>
<body>
  <div class="x-app">
    <header class="x-header">
      <a class="x-back" href="javascript:history.back()" aria-label="Back">←</a>
      <h1 class="x-header-title">Post</h1>
    </header>
    <main class="x-thread">
      ${postsHtml}
    </main>
  </div>
  ${widgetScript}
</body>
</html>`
}

Deno.serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return textResponse('Method not allowed', 405)
  }

  const url = new URL(req.url)
  const { token, format } = extractTokenAndFormat(url)
  if (!token) {
    return format === 'html' ? htmlResponse('<h1>Invalid token</h1>', 400) : textResponse('Invalid token', 400)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false }
  })

  const { data, error } = await supabase.rpc('consume_share_token', { p_token: token })
  if (error) {
    console.error('consume_share_token error:', error)
    return format === 'html' ? htmlResponse('<h1>Server error</h1>', 500) : textResponse('Server error', 500)
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row) {
    return format === 'html'
      ? htmlResponse('<h1>Link expired or invalid</h1><p>One-time links can only be opened once.</p>', 410)
      : textResponse('Link expired or invalid', 410)
  }

  const payload: Payload = {
    title: (row.title as string) || '',
    posts: (row.posts as Post[]) || [],
    author_name: (row.author_name as string) || null,
    author_handle: (row.author_handle as string) || null,
    author_avatar: (row.author_avatar as string) || null,
    created_at: (row.created_at as string) || null
  }

  if (format === 'html') {
    return htmlResponse(renderHtml(payload), 200)
  }
  return textResponse(renderMarkdown(payload.title, payload.posts), 200)
})
