#!/usr/bin/env node
// Polls metrics_events every 5s, prints new rows as JSON lines.
// Uses SUPABASE_SERVICE_ROLE_KEY (read access bypasses the no-SELECT RLS).
// Local-only: never run in CI or share the service role key.

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.')
  console.error('The service role key is local-only — never commit or expose to the browser.')
  process.exit(1)
}

const base = `${url.replace(/\/$/, '')}/rest/v1/metrics_events`
let cursor = new Date(Date.now() - 5 * 60_000).toISOString()

console.error(`[metrics-tail] starting from ${cursor}`)

async function poll() {
  const q = `?created_at=gt.${encodeURIComponent(cursor)}&order=created_at.asc&limit=200`
  const res = await fetch(base + q, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json'
    }
  })
  if (!res.ok) {
    console.error(`[metrics-tail] poll failed: ${res.status}`)
    return
  }
  const rows = await res.json()
  for (const row of rows) {
    process.stdout.write(JSON.stringify(row) + '\n')
    cursor = row.created_at
  }
}

while (true) {
  try { await poll() } catch (e) { console.error('[metrics-tail]', e.message) }
  await new Promise(r => setTimeout(r, 5000))
}
