// Observability O7 (#338, plan observability.md section 6, central-metrics D6): three alerts worked out by every run
// of the daily step. A1 errors, A2 slow, A3 capacity. Each returns the lines of the Alert shape of the Telegram
// template; the workflow sends one message per alert that is new. All limits are in LIMITS, nowhere else.
import { summary } from './histogram.js'

export const LIMITS = {
  errorsWindowH: 6,
  errorsRate: 0.02, // 5xx at least 2 % of requests ...
  errorsMin: 10, // ... and at least 10 of them
  slowWindowH: 24,
  slowP95Ms: 1000, // p95 of all API routes over 1 000 ms (needs 200 samples: MIN_SAMPLES.p95)
  capacityBytes: 700 * 1024 * 1024, // 70 % of the free 1 GB
  capacity429: 100, // n_429 in the last 24 hours, refused MCP tool calls included
  capacityOpsRows: 100000, // the ops_events guard of M2
  clearMs: 24 * 60 * 60 * 1000 // an alert is sent again only after this long without firing
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const BASELINE_MS = 7 * DAY_MS

const iso = (ms) => new Date(ms).toISOString()
// Windows are whole hourly buckets: the current hour and the (n - 1) hours before it.
const floorHour = (ms) => Math.floor(ms / HOUR_MS) * HOUR_MS
const since = (ms, hours) => floorHour(ms) - (hours - 1) * HOUR_MS
const utc = (ms) => `${iso(ms).slice(0, 16).replace('T', ' ')} UTC`
const over = (value, limit) => `${Math.round(((value - limit) / limit) * 100)} %`
const pct = (x) => `${+(x * 100).toFixed(x < 0.1 ? 1 : 0)} %`
const mb = (bytes) => `${Math.round(bytes / 1024 / 1024)} MB`
const NOT_KNOWN = 'Likely cause: not known yet.'
const NEXT = 'Next: no new message for this alert until it has been clear for 24 hours.'

async function totals(q, from, to) {
  const { rows } = await q(
    `select coalesce(sum(n), 0)::bigint as n, coalesce(sum(n_5xx), 0)::bigint as e, coalesce(sum(n_429), 0)::bigint as r
     from metrics_hourly where hour >= $1::timestamptz and hour < $2::timestamptz`,
    [iso(from), iso(to)]
  )
  return { n: Number(rows[0].n), e: Number(rows[0].e), r: Number(rows[0].r) }
}

async function topRoute(q, column, from, to) {
  const { rows } = await q(
    `select route, sum(${column})::double precision as v from metrics_hourly
     where hour >= $1::timestamptz and hour < $2::timestamptz group by route having sum(${column}) > 0
     order by v desc, route limit 1`,
    [iso(from), iso(to)]
  )
  return rows[0] ? { route: rows[0].route, v: Number(rows[0].v) } : null
}

async function p95(q, from, to) {
  const { rows } = await q(
    'select n, sum_ms, max_ms, buckets from metrics_hourly where hour >= $1::timestamptz and hour < $2::timestamptz',
    [iso(from), iso(to)]
  )
  return summary(rows.map((r) => ({ ...r, buckets: r.buckets.map(Number) })))
}

// A1: 5xx at least 2 % of requests and at least 10 of them, in the last 6 hours.
async function errors(q, now) {
  const to = floorHour(now) + HOUR_MS
  const from = since(now, LIMITS.errorsWindowH)
  const cur = await totals(q, from, to)
  if (!(cur.e >= LIMITS.errorsMin && cur.e / cur.n >= LIMITS.errorsRate)) return null
  const before = await totals(q, from - BASELINE_MS, from)
  const usual = before.n > 0 ? pct(before.e / before.n) : 'not known'
  const top = await topRoute(q, 'n_5xx', from, to)
  const rate = cur.e / cur.n
  return {
    kind: 'errors',
    headline: 'Metrics alert: the app is answering with errors',
    numberLine: (since) =>
      `Errors: ${cur.e} of ${cur.n} requests (${pct(rate)}) failed in the last ${LIMITS.errorsWindowH} hours. The limit is ${pct(LIMITS.errorsRate)} (${over(rate, LIMITS.errorsRate)} over), usual ${usual}, since ${utc(since)}.`,
    causeLine: top ? `Likely cause: ${top.route} has ${top.v} of the ${cur.e} errors.` : NOT_KNOWN,
    actionLine: NEXT,
    value: rate
  }
}

// A2: p95 of all API routes over 1 000 ms with at least 200 samples, in the last 24 hours.
async function slow(q, now) {
  const from = since(now, LIMITS.slowWindowH)
  const to = floorHour(now) + HOUR_MS
  const cur = await p95(q, from, to)
  if (cur.p95 === null || !(cur.p95 > LIMITS.slowP95Ms)) return null
  const before = await p95(q, from - BASELINE_MS, from)
  const usual = before.p95 === null ? 'not known' : `${Math.round(before.p95)} ms`
  const top = await topRoute(q, 'sum_ms', from, to)
  return {
    kind: 'slow',
    headline: 'Metrics alert: slow answers',
    numberLine: (since) =>
      `Slow: the slowest 5 % of ${cur.count} API requests took ${Math.round(cur.p95)} ms or more in ${LIMITS.slowWindowH} hours. The limit is ${LIMITS.slowP95Ms} ms (${over(cur.p95, LIMITS.slowP95Ms)} over), usual ${usual}, since ${utc(since)}.`,
    causeLine: top ? `Likely cause: ${top.route} used the most request time (${Math.round(top.v / 1000)} s).` : NOT_KNOWN,
    actionLine: NEXT,
    value: cur.p95
  }
}

// A3: the database over 700 MB, or n_429 over 100 in 24 hours, or ops_events over 100 000 rows.
async function capacity(q, now, dbBytes, limits) {
  const from = since(now, 24)
  const to = floorHour(now) + HOUR_MS
  const { r } = await totals(q, from, to)
  const { rows } = await q('select count(*)::bigint as n from ops_events')
  const opsRows = Number(rows[0].n)
  const needs = 'Needs you: open the page, then free space or decide on the Neon plan.'
  if (dbBytes > LIMITS.capacityBytes) {
    // Before this run: the daily step may just have written today's row with the current size.
    const usual = await q('select db_bytes from metrics_product_daily where db_bytes is not null and taken_at < $1::timestamptz order by day desc limit 1', [iso(now)])
    const last = usual.rows[0] ? mb(Number(usual.rows[0].db_bytes)) : 'not known'
    return {
      kind: 'capacity',
      headline: 'Metrics alert: the database is nearly full',
      numberLine: (since) =>
        `Capacity: the database is ${mb(dbBytes)}. The limit is ${mb(LIMITS.capacityBytes)} (${over(dbBytes, LIMITS.capacityBytes)} over), usual ${last}, since ${utc(since)}.`,
      causeLine: opsRows > 0 ? `Likely cause: ops_events holds ${opsRows} rows.` : NOT_KNOWN,
      actionLine: needs,
      value: dbBytes
    }
  }
  if (r > LIMITS.capacity429) {
    const prev = await totals(q, from - BASELINE_MS + DAY_MS, from)
    const usual = prev.n > 0 ? `${Math.round(prev.r / 6)}` : 'not known'
    const top = await topRoute(q, 'n_429', from, to)
    return {
      kind: 'capacity',
      headline: 'Metrics alert: many requests were refused',
      numberLine: (since) =>
        `Capacity: ${r} requests were rate limited in the last 24 hours. The limit is ${LIMITS.capacity429} (${over(r, LIMITS.capacity429)} over), usual ${usual} a day, since ${utc(since)}.`,
      causeLine: top ? `Likely cause: ${top.route} had ${top.v} of them.` : NOT_KNOWN,
      actionLine: needs,
      value: r
    }
  }
  if (opsRows > limits.capacityOpsRows) {
    return {
      kind: 'capacity',
      headline: 'Metrics alert: the ops events table is too big',
      numberLine: (since) =>
        `Capacity: ops_events holds ${opsRows} rows. The limit is ${limits.capacityOpsRows} (${over(opsRows, limits.capacityOpsRows)} over), since ${utc(since)}.`,
      causeLine: NOT_KNOWN,
      actionLine: needs,
      value: opsRows
    }
  }
  return null
}

/**
 * Works out the three alerts and updates metrics_alert_state, inside the daily transaction `q`.
 * An alert is returned (to be sent) when it starts, and again only after it did not fire for 24 hours.
 * `last_sent` holds the last time the alert was seen firing; `first_seen` the start of the current spell.
 * Returns [{ kind, headline, numberLine, causeLine, actionLine, since }] for the new alerts only.
 */
export async function runAlerts(q, { now, dbBytes, limits = LIMITS }) {
  const fired = [await errors(q, now), await slow(q, now), await capacity(q, now, dbBytes, limits)]
  const kinds = ['errors', 'slow', 'capacity']
  const out = []
  for (let i = 0; i < kinds.length; i += 1) {
    const alert = fired[i]
    if (!alert) continue
    const state = await q('select first_seen, last_sent from metrics_alert_state where kind = $1 for update', [kinds[i]])
    const seen = state.rows[0] ? new Date(state.rows[0].last_sent ?? state.rows[0].first_seen).getTime() : null
    const isNew = seen === null || now - seen >= LIMITS.clearMs
    await q(
      `insert into metrics_alert_state (kind, first_seen, last_sent, value) values ($1, $2::timestamptz, $2::timestamptz, $3)
       on conflict (kind) do update set last_sent = $2::timestamptz, value = $3,
         first_seen = case when $4::boolean then $2::timestamptz else metrics_alert_state.first_seen end`,
      [kinds[i], iso(now), alert.value, isNew]
    )
    if (isNew) {
      const { kind, headline, causeLine, actionLine } = alert
      out.push({ kind, headline, numberLine: alert.numberLine(now), causeLine, actionLine, since: iso(now) })
    }
  }
  return out
}
