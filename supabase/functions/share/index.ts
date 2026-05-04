// Edge Function: GET /functions/v1/share/<token>.<ext>
// Consumes a one-time share token and returns the draft. Supports two
// formats selected by the URL extension:
//   .md   -> markdown payload for agents
//   .html -> self-contained HTML page styled like an X.com thread

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import {
  extractTokenAndFormat,
  htmlResponse,
  renderHtml,
  renderMarkdown,
  textResponse,
  type Payload,
  type Post
} from './render.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

function logTiming(t0: number, status: number, bytes: number, format: string) {
  console.log(JSON.stringify({
    evt: 'share',
    ms: Math.round(performance.now() - t0),
    bytes,
    status,
    format
  }))
}

Deno.serve(async (req) => {
  const t0 = performance.now()

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const body = 'Method not allowed'
    logTiming(t0, 405, body.length, 'md')
    return textResponse(body, 405)
  }

  const url = new URL(req.url)
  const { token, format } = extractTokenAndFormat(url)
  if (!token) {
    const body = format === 'html' ? '<h1>Invalid token</h1>' : 'Invalid token'
    logTiming(t0, 400, body.length, format)
    return format === 'html' ? htmlResponse(body, 400) : textResponse(body, 400)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false }
  })

  const { data, error } = await supabase.rpc('consume_share_token', { p_token: token })
  if (error) {
    console.error('consume_share_token error:', error)
    const body = format === 'html' ? '<h1>Server error</h1>' : 'Server error'
    logTiming(t0, 500, body.length, format)
    return format === 'html' ? htmlResponse(body, 500) : textResponse(body, 500)
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row) {
    const body = format === 'html'
      ? '<h1>Link expired or invalid</h1><p>One-time links can only be opened once.</p>'
      : 'Link expired or invalid'
    logTiming(t0, 410, body.length, format)
    return format === 'html' ? htmlResponse(body, 410) : textResponse(body, 410)
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
    const body = renderHtml(payload)
    logTiming(t0, 200, body.length, 'html')
    return htmlResponse(body, 200)
  }

  const body = renderMarkdown(payload.title, payload.posts)
  logTiming(t0, 200, body.length, 'md')
  return textResponse(body, 200)
})
