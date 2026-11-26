// Central metrics O5 (#336): the daily step. One transaction, run by POST /api/ops/metrics-daily with the
// metrics-daily workflow's OIDC token. Idempotent. It writes one product row for yesterday when it is
// missing, moves old hourly rows into the daily table, and deletes metric rows past their retention:
// metrics_daily (400 days), ops_events (14 days) and ops_daily (400 days). No user table changes.
import { transaction } from '../db.js'

const DAY_MS = 24 * 60 * 60 * 1000
const HOURLY_KEPT_MS = 14 * DAY_MS
const DAILY_KEPT_DAYS = 400
const EVENTS_KEPT_MS = 14 * DAY_MS
const ROLLING_GRACE_MS = 6 * 60 * 60 * 1000

const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10)
const iso = (ms) => new Date(ms).toISOString()

/** Database size in bytes. Shared with O7's alert A3 and the summary's Database line. */
export async function dbSizeBytes(q) {
  const { rows } = await q('select pg_database_size(current_database())::bigint as bytes')
  return Number(rows[0].bytes)
}

// Per-day counts come from columns that never change; rolling counts are read at taken_at ($2) and are
// passed as null when rolling is false ($5). Active = a draft saved, a token used or an app used in 24 h / 7 d.
const PRODUCT_SQL = `
insert into metrics_product_daily (day, taken_at, signups, drafts_created, share_links_created, tokens_created,
  apps_connected, admin_actions_done, admin_actions_failed, admin_actions_refused, admin_actions_started,
  admin_actions_gone, active_users_24h, active_users_7d, suspended_users, db_bytes)
select $1::date, $2::timestamptz,
  (select count(*)::int from users where created_at >= $3::timestamptz and created_at < $4::timestamptz),
  (select count(*)::int from drafts where created_at >= $3::timestamptz and created_at < $4::timestamptz),
  (select count(*)::int from share_tokens where created_at >= $3::timestamptz and created_at < $4::timestamptz),
  (select count(*)::int from api_tokens where created_at >= $3::timestamptz and created_at < $4::timestamptz),
  (select count(*)::int from oauth_grants where created_at >= $3::timestamptz and created_at < $4::timestamptz),
  (select count(*)::int from admin_audit where created_at >= $3::timestamptz and created_at < $4::timestamptz and outcome = 'done'),
  (select count(*)::int from admin_audit where created_at >= $3::timestamptz and created_at < $4::timestamptz and outcome = 'failed' and coalesce(details->>'reason', '') <> 'gone'),
  (select count(*)::int from admin_audit where created_at >= $3::timestamptz and created_at < $4::timestamptz and outcome = 'refused'),
  (select count(*)::int from admin_audit where created_at >= $3::timestamptz and created_at < $4::timestamptz and outcome = 'started'),
  (select count(*)::int from admin_audit where created_at >= $3::timestamptz and created_at < $4::timestamptz and outcome = 'failed' and details->>'reason' = 'gone'),
  case when $5::boolean then (select count(distinct user_id)::int from (
    select user_id, updated_at as at from drafts
    union all select user_id, last_used_at from api_tokens where last_used_at is not null
    union all select user_id, last_used_at from oauth_grants where last_used_at is not null) a
    where at >= $2::timestamptz - interval '24 hours') end,
  case when $5::boolean then (select count(distinct user_id)::int from (
    select user_id, updated_at as at from drafts
    union all select user_id, last_used_at from api_tokens where last_used_at is not null
    union all select user_id, last_used_at from oauth_grants where last_used_at is not null) a
    where at >= $2::timestamptz - interval '7 days') end,
  case when $5::boolean then (select count(*)::int from users where suspended_at is not null) end,
  case when $5::boolean then $6::bigint end
on conflict (day) do nothing
returning day`

// Moves hourly rows older than the cut into the daily table in one statement. Counters are summed, max_ms is
// the max and buckets are added position by position (unnest with ordinality, never a bare unnest(a, b)).
const MOVE_SQL = `
with moved as (delete from metrics_hourly where hour < $1::timestamptz returning *),
sums as (
  select (hour at time zone 'UTC')::date as day, route, op, caller,
    sum(n)::int as n, sum(n_3xx)::int as n_3xx, sum(n_4xx)::int as n_4xx, sum(n_429)::int as n_429,
    sum(n_5xx)::int as n_5xx, sum(n_tool_error)::int as n_tool_error, sum(sum_ms) as sum_ms, max(max_ms) as max_ms,
    sum(sum_db_ms) as sum_db_ms, sum(sum_q)::int as sum_q, sum(sum_conn)::int as sum_conn, sum(cold)::int as cold
  from moved group by 1, 2, 3, 4
),
per_position as (
  select (m.hour at time zone 'UTC')::date as day, m.route, m.op, m.caller, u.i, sum(u.b)::int as b
  from moved m cross join lateral unnest(m.buckets) with ordinality as u(b, i)
  group by 1, 2, 3, 4, 5
),
shapes as (
  select day, route, op, caller, array_agg(b order by i)::int[] as buckets from per_position group by 1, 2, 3, 4
),
ins as (
  insert into metrics_daily (day, route, op, caller, n, n_3xx, n_4xx, n_429, n_5xx, n_tool_error, sum_ms, max_ms,
    sum_db_ms, sum_q, sum_conn, cold, buckets)
  select s.day, s.route, s.op, s.caller, s.n, s.n_3xx, s.n_4xx, s.n_429, s.n_5xx, s.n_tool_error, s.sum_ms, s.max_ms,
    s.sum_db_ms, s.sum_q, s.sum_conn, s.cold, sh.buckets
  from sums s join shapes sh using (day, route, op, caller)
  on conflict (day, route, op, caller) do update set
    n = metrics_daily.n + excluded.n,
    n_3xx = metrics_daily.n_3xx + excluded.n_3xx,
    n_4xx = metrics_daily.n_4xx + excluded.n_4xx,
    n_429 = metrics_daily.n_429 + excluded.n_429,
    n_5xx = metrics_daily.n_5xx + excluded.n_5xx,
    n_tool_error = metrics_daily.n_tool_error + excluded.n_tool_error,
    sum_ms = metrics_daily.sum_ms + excluded.sum_ms,
    max_ms = greatest(metrics_daily.max_ms, excluded.max_ms),
    sum_db_ms = metrics_daily.sum_db_ms + excluded.sum_db_ms,
    sum_q = metrics_daily.sum_q + excluded.sum_q,
    sum_conn = metrics_daily.sum_conn + excluded.sum_conn,
    cold = metrics_daily.cold + excluded.cold,
    buckets = (select array_agg(coalesce(x, 0) + coalesce(y, 0) order by i)::int[]
      from unnest(metrics_daily.buckets, excluded.buckets) with ordinality as t(x, y, i))
  returning 1
)
select (select count(*)::int from moved) as moved, (select count(*)::int from ins) as written`

/**
 * The daily step. `now` is the run time (a test passes its own). Returns counts only:
 * { product_day_written, hourly_moved, daily_deleted, ops_events_deleted, ops_daily_deleted }.
 */
export async function runDailyStep({ now = Date.now() } = {}) {
  const startOfToday = Date.parse(`${utcDay(now)}T00:00:00.000Z`)
  const yesterdayStart = startOfToday - DAY_MS
  const rolling = now - startOfToday <= ROLLING_GRACE_MS
  return transaction(async (q) => {
    const dbBytes = rolling ? await dbSizeBytes(q) : null
    const product = await q(PRODUCT_SQL, [
      utcDay(yesterdayStart),
      iso(now),
      iso(yesterdayStart),
      iso(startOfToday),
      rolling,
      dbBytes
    ])
    const moved = await q(MOVE_SQL, [iso(now - HOURLY_KEPT_MS)])
    const daily = await q(
      'with gone as (delete from metrics_daily where day < $1::date returning 1) select count(*)::int as n from gone',
      [utcDay(now - DAILY_KEPT_DAYS * DAY_MS)]
    )
    const events = await q(
      'with gone as (delete from ops_events where at < $1::timestamptz returning 1) select count(*)::int as n from gone',
      [iso(now - EVENTS_KEPT_MS)]
    )
    const counters = await q(
      'with gone as (delete from ops_daily where day < $1::date returning 1) select count(*)::int as n from gone',
      [utcDay(now - DAILY_KEPT_DAYS * DAY_MS)]
    )
    return {
      product_day_written: product.rows.length,
      hourly_moved: moved.rows[0].moved,
      daily_deleted: daily.rows[0].n,
      ops_events_deleted: events.rows[0].n,
      ops_daily_deleted: counters.rows[0].n
    }
  })
}
