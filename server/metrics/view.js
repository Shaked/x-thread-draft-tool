// Observability plan O4 (#335): the admin metrics view. The one place that defines the response shape of
// GET /api/admin/metrics and GET /api/admin/metrics/series (and, later, the summary's Production line, #451).
// Reads only; nothing here writes. Windows end now: `1h` is the current UTC hour so far, `24h` is the last
// 24 UTC hours including the current one, and so on. Hourly rows cover the last 14 days; a window that starts
// earlier also counts the daily rows of its first day and after, so such a window starts on a whole UTC day.
import { summary } from './histogram.js'
import { groupRows, productRows, seriesRows, PRODUCT_COLUMNS, DIMENSIONS } from './queries.js'
import { HttpError } from '../http.js'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const CACHE_MS = 60 * 1000
const CACHE_MAX = 200

/** Window name -> number of UTC hours it covers. */
const WINDOWS = { '1h': 1, '24h': 24, '7d': 7 * 24, '30d': 30 * 24, '90d': 90 * 24, '400d': 400 * 24 }
/** Series windows: hourly points up to 7 days, daily points after that. */
const SERIES_WINDOWS = ['24h', '7d', '30d', '90d', '400d']
const HOURLY_SERIES_MAX_HOURS = 7 * 24

/** Request series: a counter column of a group, or a percentile of its histogram. */
const COUNT_SERIES = { requests: 'n', errors_5xx: 'n_5xx', errors_4xx: 'n_4xx', rate_limited: 'n_429', cold_starts: 'cold' }
const PERCENTILE_SERIES = ['p50', 'p95', 'p99']
const PRODUCT_SERIES = PRODUCT_COLUMNS
const ROLLING = new Set(['active_users_24h', 'active_users_7d', 'suspended_users', 'db_bytes'])

const SERIES_NAMES = [...Object.keys(COUNT_SERIES), ...PERCENTILE_SERIES, ...PRODUCT_SERIES]

const bad = (message) => new HttpError(400, message)
const iso = (ms) => new Date(ms).toISOString()
const utcDay = (ms) => iso(ms).slice(0, 10)

/** The start of the UTC hour of `ms`. */
const hourStart = (ms) => Math.floor(ms / HOUR) * HOUR

/** The window that ends now: its name, its first UTC hour (ms) and the times as text. */
function windowOf(name, now) {
  const hours = WINDOWS[name]
  let fromHour = hourStart(now) - (hours - 1) * HOUR
  // Past the 14 days of hourly rows the window counts whole UTC days (the daily rows), so it starts at midnight.
  if (hours > 14 * 24) fromHour = Math.floor(fromHour / DAY) * DAY
  return { name, hours, fromHour, from: iso(fromHour), to: iso(now) }
}

/** A route key of the app ("GET /drafts/:id") or `unmatched`. `routeKeys` is the set of keys from server/router.js. */
function checkRoute(route, routeKeys) {
  if (route === null) return null
  if (route !== 'unmatched' && !routeKeys.has(route)) {
    throw bad('route must be a route of this app, for example GET /drafts/:id, or unmatched.')
  }
  return route
}

/** The query parameters of GET /api/admin/metrics, checked. Anything wrong is 400. */
export function metricsParams(searchParams, routeKeys) {
  const window = searchParams.get('window') ?? '24h'
  if (!Object.hasOwn(WINDOWS, window)) throw bad(`window must be one of ${Object.keys(WINDOWS).join(', ')}.`)
  const by = searchParams.get('by') ?? 'route'
  if (!Object.hasOwn(DIMENSIONS, by)) throw bad(`by must be one of ${Object.keys(DIMENSIONS).join(', ')}.`)
  const route = checkRoute(searchParams.get('route'), routeKeys)
  return { window, by, route }
}

/** The query parameters of GET /api/admin/metrics/series, checked. Anything wrong is 400. */
export function seriesParams(searchParams, routeKeys) {
  const name = searchParams.get('name')
  if (!SERIES_NAMES.includes(name)) throw bad(`name must be one of ${SERIES_NAMES.join(', ')}.`)
  const window = searchParams.get('window') ?? '7d'
  if (!SERIES_WINDOWS.includes(window)) throw bad(`window must be one of ${SERIES_WINDOWS.join(', ')}.`)
  const route = checkRoute(searchParams.get('route'), routeKeys)
  if (route !== null && !(name in COUNT_SERIES) && !PERCENTILE_SERIES.includes(name)) {
    throw bad('route applies only to request series (requests, errors, rate_limited, cold_starts, p50, p95, p99).')
  }
  return { name, window, route }
}

// The fields of one group or one point: counts, errors, cold starts and the percentiles of its histogram.
const EMPTY = { n: 0, n_4xx: 0, n_429: 0, n_5xx: 0, n_tool_error: 0, cold: 0, sum_ms: 0, max_ms: 0, buckets: new Array(65).fill(0) }

function fieldsOf(row) {
  const r = row ?? EMPTY
  const s = summary([{ n: r.n, sum_ms: r.sum_ms, max_ms: r.max_ms, buckets: r.buckets }])
  return {
    count: s.count,
    errors: { '4xx': r.n_4xx, '429': r.n_429, '5xx': r.n_5xx, tool_error: r.n_tool_error },
    cold: r.cold,
    p50: s.p50,
    p90: s.p90,
    p95: s.p95,
    p99: s.p99,
    p99_9: s.p99_9,
    mean: s.mean,
    max: s.max,
    low_samples: s.low_samples
  }
}

/** The `group` of a row: the dimensions `by` names; the others read `all` (op reads `-`), as in the plan. */
function groupOf(by, row) {
  const dims = DIMENSIONS[by]
  return {
    route: dims.includes('route') ? row.route : 'all',
    op: dims.includes('op') ? row.op : '-',
    caller: dims.includes('caller') ? row.caller : 'all'
  }
}

/** GET /api/admin/metrics: one entry per group, biggest count first, at most 200. */
export async function metricsView({ window, by, route }, now = Date.now()) {
  const w = windowOf(window, now)
  const rows = await groupRows({ by, from: w.from, day: utcDay(w.fromHour), route, to: iso(hourStart(now) + HOUR) })
  const as_of = iso(now)
  return {
    as_of,
    window: { name: w.name, from: w.from, to: w.to },
    metrics: rows.map((row) => ({
      name: 'latency',
      group: groupOf(by, row),
      window: w.name,
      ...fieldsOf(row),
      unit: 'ms',
      source: 'app_rollup',
      as_of
    }))
  }
}

/** The keys (and times) of every point of a window: hours up to 7 days, UTC days after that (or days, when forced). */
function pointsOf(w, now, forced = null) {
  const grain = forced ?? (w.hours <= HOURLY_SERIES_MAX_HOURS ? 'hour' : 'day')
  const keys = []
  if (grain === 'hour') {
    for (let t = w.fromHour; t <= now; t += HOUR) keys.push({ key: iso(t).slice(0, 13) + ':00:00Z', at: t })
  } else {
    for (let t = Date.parse(`${utcDay(w.fromHour)}T00:00:00Z`); t <= now; t += DAY) keys.push({ key: utcDay(t), at: t })
  }
  return { grain, keys }
}

/** GET /api/admin/metrics/series: one point per hour or day of the window, with zeros where nothing happened. */
export async function seriesView({ name, window, route }, now = Date.now()) {
  const w = windowOf(window, now)
  const as_of = iso(now)

  if (PRODUCT_SERIES.includes(name)) {
    // Product numbers are one row per UTC day, so their points are days whatever the window.
    const { keys } = pointsOf(w, now, 'day')
    const base = { as_of, name, route: 'all', window: { name: window, from: w.from, to: w.to }, grain: 'day' }
    const rows = new Map((await productRows({ column: name, from: utcDay(w.fromHour), to: utcDay(now) })).map((row) => [row.k, row]))
    const unit = name === 'db_bytes' ? 'bytes' : 'count'
    const points = keys.map(({ key, at }) => {
      const row = rows.get(key)
      const value = row?.v ?? null
      return {
        at: iso(at),
        value,
        unit,
        source: 'product_daily',
        taken_at: ROLLING.has(name) && value !== null ? row.taken_at : null,
        as_of
      }
    })
    return { ...base, unit, points }
  }

  const { grain, keys } = pointsOf(w, now)
  const base = { as_of, name, route: route ?? 'all', window: { name: window, from: w.from, to: w.to }, grain }
  const rows = new Map((await seriesRows({ grain, from: w.from, day: utcDay(w.fromHour), route })).map((row) => [row.k, row]))
  const isCount = name in COUNT_SERIES
  const column = COUNT_SERIES[name]
  const points = keys.map(({ key, at }) => {
    const row = rows.get(key)
    const fields = fieldsOf(row)
    const value = isCount ? (row ? row[column] : 0) : fields[name]
    return { at: iso(at), name, value, unit: isCount ? 'count' : 'ms', ...fields, source: 'app_rollup', as_of }
  })
  return { ...base, unit: isCount ? 'count' : 'ms', points }
}

const cache = new Map()

/** Runs `build` at most once a minute for each key (the plan's 60 s cache). A failed build is not cached. */
export async function cached(key, build, now = Date.now()) {
  const hit = cache.get(key)
  if (hit && now - hit.at < CACHE_MS) return hit.body
  const body = await build()
  if (cache.size >= CACHE_MAX) cache.clear()
  cache.set(key, { at: now, body })
  return body
}

/** Test helper: the cache starts empty. */
export function resetMetricsCacheForTests() {
  cache.clear()
}
