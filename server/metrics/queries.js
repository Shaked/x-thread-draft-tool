// Observability plan O4 (#335): the SQL of the admin metrics views (server/metrics/view.js).
// Histograms are added up in SQL: one row per group (or per point), with its 65 counters as one array.
// Dimension and column names come from fixed lists below, never from the request; values are parameters.
// Hourly rows (metrics_hourly) and daily rows (metrics_daily) hold disjoint hours, so their sum is exact.
import { query } from '../db.js'

/** The group columns for each `by` value. */
export const DIMENSIONS = {
  route: ['route'],
  op: ['op'],
  caller: ['caller'],
  all: ['route', 'op', 'caller'],
  total: ['total'] // one group for the whole window: the summary row of the admin page (#337)
}

/** Columns of metrics_product_daily that a series may name. The rolling ones are read at taken_at. */
export const PRODUCT_COLUMNS = [
  'signups', 'drafts_created', 'share_links_created', 'tokens_created', 'apps_connected',
  'admin_actions_done', 'admin_actions_failed', 'admin_actions_refused', 'admin_actions_started', 'admin_actions_gone',
  'active_users_24h', 'active_users_7d', 'suspended_users', 'db_bytes'
]

const MAX_GROUPS = 200

// The same columns in metrics_hourly and metrics_daily, in the same order.
const SOURCE = 'n, n_4xx, n_429, n_5xx, n_tool_error, cold, sum_ms, max_ms, buckets'

/** Rows of one window grouped by `by`: at most 200, the biggest count first. Each row has the histogram of its group. */
export async function groupRows({ by, from, day, route, to = null }) {
  const dims = DIMENSIONS[by].join(', ')
  const params = [from, day]
  let filter = ''
  if (route !== null) {
    params.push(route)
    filter = ` and route = $${params.length}`
  }
  // `to` (the end of the last hour wanted) lets the summary read the 7 days before a window with the same query.
  let until = ''
  if (to !== null) {
    params.push(to)
    until = ` and hour < $${params.length}::timestamptz`
  }
  const sql = `
with src as (
  select route, op, caller, 'all'::text as total, ${SOURCE} from metrics_hourly where hour >= $1::timestamptz${filter}${until}
  union all
  select route, op, caller, 'all'::text as total, ${SOURCE} from metrics_daily where day >= $2::date${filter}
),
grouped as (
  select ${dims},
    sum(n)::bigint as n, sum(n_4xx)::bigint as n_4xx, sum(n_429)::bigint as n_429, sum(n_5xx)::bigint as n_5xx,
    sum(n_tool_error)::bigint as n_tool_error, sum(cold)::bigint as cold,
    sum(sum_ms)::double precision as sum_ms, max(max_ms)::double precision as max_ms
  from src group by ${dims}
),
pos as (
  select ${dims}, u.i, sum(u.b)::bigint as b
  from src cross join lateral unnest(src.buckets) with ordinality as u(b, i)
  group by ${dims}, u.i
),
shape as (
  select ${dims}, array_agg(b order by i) as buckets from pos group by ${dims}
)
select g.*, s.buckets from grouped g join shape s using (${dims})
order by g.n desc, ${dims} limit ${MAX_GROUPS}`
  const { rows } = await query(sql, params)
  return rows.map(numbered)
}

/**
 * Points of one request series: one per UTC hour ('hour') or UTC day ('day'). `k` is the point key
 * ("2026-11-26T10:00:00Z" or "2026-11-26"), the same text the view builds for each point.
 */
export async function seriesRows({ grain, from, day, route }) {
  const params = [from]
  let filter = ''
  if (route !== null) {
    params.push(route)
    filter = ` and route = $${params.length}`
  }
  const hourKey =
    grain === 'hour'
      ? `to_char(hour at time zone 'UTC', 'YYYY-MM-DD"T"HH24:00:00"Z"')`
      : `to_char(hour at time zone 'UTC', 'YYYY-MM-DD')`
  let daily = ''
  if (grain === 'day') {
    params.push(day)
    daily = `union all select to_char(day, 'YYYY-MM-DD') as k, ${SOURCE} from metrics_daily where day >= $${params.length}::date${filter}`
  }
  const sql = `
with src as (
  select ${hourKey} as k, ${SOURCE} from metrics_hourly where hour >= $1::timestamptz${filter}
  ${daily}
),
grouped as (
  select k,
    sum(n)::bigint as n, sum(n_4xx)::bigint as n_4xx, sum(n_429)::bigint as n_429, sum(n_5xx)::bigint as n_5xx,
    sum(n_tool_error)::bigint as n_tool_error, sum(cold)::bigint as cold,
    sum(sum_ms)::double precision as sum_ms, max(max_ms)::double precision as max_ms
  from src group by k
),
pos as (
  select k, u.i, sum(u.b)::bigint as b
  from src cross join lateral unnest(src.buckets) with ordinality as u(b, i)
  group by k, u.i
),
shape as (
  select k, array_agg(b order by i) as buckets from pos group by k
)
select g.*, s.buckets from grouped g join shape s using (k)`
  const { rows } = await query(sql, params)
  return rows.map(numbered)
}

/** The product numbers of one column for the days from `from` to `to` (UTC dates). A day without a row is absent. */
export async function productRows({ column, from, to }) {
  if (!PRODUCT_COLUMNS.includes(column)) throw new RangeError(`unknown product column: ${column}`)
  const { rows } = await query(
    `select to_char(day, 'YYYY-MM-DD') as k, ${column} as v, taken_at from metrics_product_daily
     where day >= $1::date and day <= $2::date order by day`,
    [from, to]
  )
  return rows.map((row) => ({
    k: row.k,
    v: row.v === null ? null : Number(row.v),
    taken_at: row.taken_at === null ? null : new Date(row.taken_at).toISOString()
  }))
}

// node-postgres returns bigint as text; the view works in numbers only.
function numbered(row) {
  return {
    k: row.k,
    route: row.route,
    op: row.op,
    caller: row.caller,
    n: Number(row.n),
    n_4xx: Number(row.n_4xx),
    n_429: Number(row.n_429),
    n_5xx: Number(row.n_5xx),
    n_tool_error: Number(row.n_tool_error),
    cold: Number(row.cold),
    sum_ms: Number(row.sum_ms),
    max_ms: Number(row.max_ms),
    buckets: row.buckets.map(Number)
  }
}
