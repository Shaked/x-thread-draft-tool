// Edge Function: GET /functions/v1/metrics?viewableOnlyWith=<token>
// Returns a Markdown report of aggregated performance metrics.
//
// Stealth 404: any rejection (missing token, wrong token, wrong method,
// invalid period, malformed query) returns a response indistinguishable
// from a non-existent route. No 401, no 403, no 405, no logging on reject.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const METRICS_TOKEN = Deno.env.get('METRICS_TOKEN') ?? ''

// Match Supabase's stock 404 response shape as closely as we can.
function notFound(): Response {
  return new Response('Not Found', {
    status: 404,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex'
    }
  })
}

function constantTimeEqual(a: string, b: string): boolean {
  // Always compare against METRICS_TOKEN length to keep timing consistent
  // even when the supplied value is missing or truncated.
  const aBytes = new TextEncoder().encode(a)
  const bBytes = new TextEncoder().encode(b)
  const len = Math.max(aBytes.length, bBytes.length, 1)
  let diff = aBytes.length ^ bBytes.length
  for (let i = 0; i < len; i++) {
    const x = aBytes[i] ?? 0
    const y = bBytes[i] ?? 0
    diff |= x ^ y
  }
  return diff === 0
}

function extractToken(req: Request, url: URL): string {
  const auth = req.headers.get('authorization') ?? ''
  if (auth.startsWith('Bearer ')) return auth.slice(7)
  return url.searchParams.get('viewableOnlyWith') ?? ''
}

function parsePeriod(raw: string | null): string | null {
  const v = (raw ?? '7d').toLowerCase()
  if (v === '24h') return '24 hours'
  if (v === '7d') return '7 days'
  if (v === '30d') return '30 days'
  return null
}

function fmtNum(n: unknown): string {
  if (n === null || n === undefined) return '—'
  const num = typeof n === 'number' ? n : Number(n)
  if (!isFinite(num)) return '—'
  return num.toLocaleString('en-US')
}

function renderReport(period: string, summary: Record<string, unknown>): string {
  const vol = (summary.volume ?? {}) as Record<string, unknown>
  const volPrev = (summary.volume_prev ?? {}) as Record<string, unknown>
  const vitals = (summary.vitals ?? []) as Array<Record<string, unknown>>
  const heap = (summary.heap_dom_at_hide ?? {}) as Record<string, unknown>
  const longtasks = (summary.longtasks_top ?? []) as Array<Record<string, unknown>>
  const byUa = (vol.by_ua ?? {}) as Record<string, Record<string, unknown>>

  const evictionRate = (vol.pageviews && Number(vol.pageviews) > 0)
    ? ((Number(vol.evictions) / Number(vol.pageviews)) * 100).toFixed(2)
    : '0.00'
  const evictionRatePrev = (volPrev.pageviews && Number(volPrev.pageviews) > 0)
    ? ((Number(volPrev.evictions) / Number(volPrev.pageviews)) * 100).toFixed(2)
    : '0.00'

  let md = `# Metrics report — last ${period}\n\n`
  md += `Generated at: ${summary.generated_at ?? new Date().toISOString()}\n\n`

  md += `## Volume & eviction\n\n`
  md += `| Metric | Current | Prior period |\n`
  md += `|---|---:|---:|\n`
  md += `| Pageviews | ${fmtNum(vol.pageviews)} | ${fmtNum(volPrev.pageviews)} |\n`
  md += `| Sessions | ${fmtNum(vol.sessions)} | — |\n`
  md += `| Likely-evicted reloads | ${fmtNum(vol.evictions)} | ${fmtNum(volPrev.evictions)} |\n`
  md += `| Eviction rate | ${evictionRate}% | ${evictionRatePrev}% |\n`
  md += `| bfcache restores | ${fmtNum(vol.bfcache_restores)} | — |\n\n`

  md += `### By UA family\n\n`
  md += `| UA family | Pageviews | Evictions | Rate |\n`
  md += `|---|---:|---:|---:|\n`
  for (const [family, counts] of Object.entries(byUa)) {
    md += `| ${family} | ${fmtNum(counts.pageviews)} | ${fmtNum(counts.evictions)} | ${counts.eviction_rate ?? 0}% |\n`
  }
  md += `\n`

  md += `## Web Vitals (p75 / p95)\n\n`
  md += `| Metric | UA family | Samples | p75 | p95 |\n`
  md += `|---|---|---:|---:|---:|\n`
  for (const v of vitals) {
    md += `| ${v.metric} | ${v.ua_family} | ${fmtNum(v.samples)} | ${fmtNum(v.p75)} | ${fmtNum(v.p95)} |\n`
  }
  md += `\n`

  md += `## Heap & DOM at last hide before eviction\n\n`
  md += `Distribution of what the page looked like the moment iOS decided whether to keep it. High values here correlate with high eviction rate above — these are the levers to optimize.\n\n`
  md += `| Stat | Value |\n`
  md += `|---|---:|\n`
  md += `| Samples | ${fmtNum(heap.samples)} |\n`
  md += `| JS heap p50 | ${fmtNum(heap.heap_p50_mb)} MB |\n`
  md += `| JS heap p95 | ${fmtNum(heap.heap_p95_mb)} MB |\n`
  md += `| DOM nodes p50 | ${fmtNum(heap.dom_p50)} |\n`
  md += `| DOM nodes p95 | ${fmtNum(heap.dom_p95)} |\n`
  md += `| Storage usage p95 | ${fmtNum(heap.storage_p95_mb)} MB |\n\n`
  md += `Note: \`performance.memory\` is unavailable on iOS Safari, so heap rows are biased toward Chromium clients.\n\n`

  md += `## Long-task hotspots (top 10 by total time)\n\n`
  md += `| Route | Samples | Total ms | Avg ms | Max ms |\n`
  md += `|---|---:|---:|---:|---:|\n`
  for (const l of longtasks) {
    md += `| ${l.url_path ?? '(unknown)'} | ${fmtNum(l.samples)} | ${fmtNum(l.total_ms)} | ${fmtNum(l.avg_ms)} | ${fmtNum(l.max_ms)} |\n`
  }
  md += `\n`

  md += `## Share Edge Function timing\n\n`
  md += `Not stored in the metrics table. Run in Supabase log explorer:\n\n`
  md += `\`\`\`\n` +
        `event_message ~ 'evt' and metadata.function_id is not null\n` +
        `\`\`\`\n\n` +
        `or filter the share function logs and parse JSON \`evt:share, ms, bytes, status\` lines.\n`

  return md
}

Deno.serve(async (req) => {
  // Validate everything; on any failure return the same 404. Don't short-
  // circuit on early rejections — execute the constant-time compare in all
  // paths so timing is uniform.
  const url = new URL(req.url)
  const supplied = extractToken(req, url)
  const tokenOk = constantTimeEqual(supplied, METRICS_TOKEN)
  const methodOk = req.method === 'GET' || req.method === 'HEAD'
  const periodSql = parsePeriod(url.searchParams.get('period'))
  const periodLabel = (url.searchParams.get('period') ?? '7d').toLowerCase()
  const formatRaw = (url.searchParams.get('format') ?? 'md').toLowerCase()
  const formatOk = formatRaw === 'md' || formatRaw === 'json'

  if (!tokenOk || !methodOk || !periodSql || !formatOk || !METRICS_TOKEN) {
    return notFound()
  }

  if (req.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: {
        'Content-Type': formatRaw === 'json'
          ? 'application/json; charset=utf-8'
          : 'text/markdown; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex'
      }
    })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  const { data, error } = await supabase.rpc('metrics_summary', { p_period: periodSql })
  if (error || !data) {
    // Don't leak whether the function exists. Same 404 on internal failure.
    return notFound()
  }

  if (formatRaw === 'json') {
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex'
      }
    })
  }

  const md = renderReport(periodLabel, data as Record<string, unknown>)
  return new Response(md, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex'
    }
  })
})
