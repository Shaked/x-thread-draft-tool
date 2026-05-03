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
