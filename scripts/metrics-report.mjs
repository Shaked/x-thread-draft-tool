#!/usr/bin/env node
// Local wrapper around the deployed /metrics endpoint.
// Same code path Claude uses: WebFetch → /functions/v1/metrics with token.
// Reads VITE_SUPABASE_URL (or SUPABASE_URL) and METRICS_TOKEN from .env.local.

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const token = process.env.METRICS_TOKEN
const period = process.argv.find(a => a.startsWith('--period='))?.slice(9) || '7d'

if (!url) {
  console.error('Missing VITE_SUPABASE_URL (or SUPABASE_URL) in .env.local.')
  process.exit(1)
}
if (!token) {
  console.error('Missing METRICS_TOKEN in .env.local.')
  console.error('Set it on the server with:')
  console.error('  supabase secrets set METRICS_TOKEN="<long-random>" --project-ref <ref>')
  console.error('Then add the same value to your local .env.local.')
  process.exit(1)
}

const endpoint = `${url.replace(/\/$/, '')}/functions/v1/metrics?viewableOnlyWith=${encodeURIComponent(token)}&period=${encodeURIComponent(period)}`

const res = await fetch(endpoint, {
  headers: { Accept: 'text/markdown' }
})

if (!res.ok) {
  console.error(`Request failed: ${res.status} ${res.statusText}`)
  console.error('Possible causes: wrong METRICS_TOKEN, function not deployed, or network issue.')
  process.exit(1)
}

const body = await res.text()
process.stdout.write(body)
