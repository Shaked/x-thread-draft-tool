// Edge Function: GET /functions/v1/share/<token>
// Consumes a one-time share token and returns the draft as markdown.
// Vercel rewrite maps /share/<token>.md -> here.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function textResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex'
    }
  })
}

function extractToken(url: URL): string | null {
  // Path is /share/<token> (trailing .md stripped by Vercel rewrite,
  // but tolerate it here too in case the function is hit directly).
  const parts = url.pathname.split('/').filter(Boolean)
  let token = parts[parts.length - 1] || ''
  if (token.endsWith('.md')) token = token.slice(0, -3)
  return UUID_RE.test(token) ? token : null
}

function renderMarkdown(title: string, posts: Array<Record<string, unknown>>): string {
  const total = posts.length
  let md = `# ${title || 'Thread'}\n\n`

  posts.forEach((post, i) => {
    md += `## ${i + 1}/${total}\n\n`
    md += `${(post.text as string) || ''}\n\n`

    const images = (post.images as Array<unknown>) || []
    if (images.length > 0) {
      images.forEach((img, idx) => {
        const url = typeof img === 'string' ? img : (img as { url?: string })?.url
        if (url) md += `![Image ${idx + 1}](${url})\n`
      })
      md += '\n'
    }

    const embed = post.embeddedTweet as string | undefined
    if (embed) md += `> Embedded tweet: ${embed}\n\n`
  })

  return md
}

Deno.serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return textResponse('Method not allowed', 405)
  }

  const url = new URL(req.url)
  const token = extractToken(url)
  if (!token) {
    return textResponse('Invalid token', 400)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false }
  })

  const { data, error } = await supabase.rpc('consume_share_token', { p_token: token })
  if (error) {
    console.error('consume_share_token error:', error)
    return textResponse('Server error', 500)
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row) {
    return textResponse('Link expired or invalid', 410)
  }

  const md = renderMarkdown(row.title as string, (row.posts as Array<Record<string, unknown>>) || [])
  return textResponse(md, 200)
})
