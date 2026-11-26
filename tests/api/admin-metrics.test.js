// @vitest-environment node
// Observability plan O4 (#335): GET /api/admin/metrics and /series, and the tools admin_metrics and
// admin_metrics_series. Rows are seeded here, so each expected number is worked out by hand:
// 8 ms falls in histogram counter 13 (its middle is 8.7 ms, capped at the group's max of 8 ms), and 16 ms
// and 4 ms fall in counters 17 and 9. Percentiles need 20 (p50), 100 (p90), 200 (p95), 1000 (p99) samples.
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({
  putBlob: vi.fn(),
  deleteBlobUrls: vi.fn(async () => {}),
  listBlobPrefix: vi.fn(async () => ({ files: [], truncated: false }))
}))

import { route } from '../../server/router.js'
import { runAs } from '../../server/caller-context.js'
import { issuePair, resolveAccess } from '../../server/oauth/tokens.js'
import { ADMIN_TOOLS } from '../../server/mcp/admin-tools.js'
import { oneHot } from '../../server/metrics/histogram.js'
import { resetMetricsCacheForTests } from '../../server/metrics/view.js'
import { APP_URL, setupTestDb } from './helpers/db.js'

const MCP = `${APP_URL}/api/mcp`
const CLIENT = 'xtc_admin_metrics_test'
const ADMIN_GITHUB_ID = 960015
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

let db
let admin
let grantSeq = 0
let now

const iso = (ms) => new Date(ms).toISOString()
const utcDay = (ms) => iso(ms).slice(0, 10)
const hourOf = (ms) => Math.floor(ms / HOUR) * HOUR
/** A histogram with `n` samples, all at `ms`. */
const samples = (ms, n) => oneHot(ms).map((v) => v * n)
const literal = (counts) => `{${counts.join(',')}}`

// The admin and one client are made once (the file runs in the API test budget); each test resets only the metric rows.
beforeAll(async () => {
  db = await setupTestDb()
  admin = await db.insertUser({ github_id: ADMIN_GITHUB_ID, login: 'shaked', name: 'Owner' })
  await db.pg.query("insert into oauth_clients (client_id, kind, client_name, redirect_uris) values ($1, 'registered', 'Admin metrics test', '{}')", [CLIENT])
})

beforeEach(async () => {
  await db.pg.exec('delete from metrics_hourly; delete from metrics_daily; delete from metrics_product_daily')
  resetMetricsCacheForTests()
  now = Date.now()
  await seedRows()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

/** Hourly rows, a daily row 20 days back, and yesterday's product numbers. */
async function seedRows() {
  const hour = hourOf(now)
  const rows = [
    // A: 25 requests at 8 ms, 2 client errors, 1 rate limit, 1 server error, 1 cold start, last hour.
    { hour: hour - HOUR, route: 'GET /drafts/:id', op: '-', caller: 'web', n: 25, n_4xx: 2, n_429: 1, n_5xx: 1, sum_ms: 200, max_ms: 8, cold: 1, buckets: samples(8, 25) },
    // B: 10 requests at 16 ms, the hour before that, from an MCP client.
    { hour: hour - 2 * HOUR, route: 'GET /drafts', op: '-', caller: 'mcp:claude', n: 10, n_4xx: 0, n_429: 0, n_5xx: 0, sum_ms: 160, max_ms: 16, cold: 0, buckets: samples(16, 10) },
    // C: one request at 4 ms in the current hour.
    { hour, route: 'GET /drafts/:id', op: '-', caller: 'web', n: 1, n_4xx: 0, n_429: 0, n_5xx: 0, sum_ms: 4, max_ms: 4, cold: 0, buckets: samples(4, 1) }
  ]
  for (const r of rows) {
    await db.pg.query(
      `insert into metrics_hourly (hour, route, op, caller, n, n_4xx, n_429, n_5xx, sum_ms, max_ms, cold, buckets)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [iso(r.hour), r.route, r.op, r.caller, r.n, r.n_4xx, r.n_429, r.n_5xx, r.sum_ms, r.max_ms, r.cold, literal(r.buckets)]
    )
  }
  // D: a daily row 20 days back, 100 requests at 8 ms (moved out of the hourly table).
  await db.pg.query(
    `insert into metrics_daily (day, route, op, caller, n, n_4xx, sum_ms, max_ms, cold, buckets)
     values ($1, 'GET /drafts/:id', '-', 'web', 100, 0, 800, 8, 0, $2)`,
    [utcDay(now - 20 * DAY), literal(samples(8, 100))]
  )
  // Product numbers for yesterday: 3 sign-ups, 7 users active in 24 h (a rolling number), 12345 bytes.
  await db.pg.query(
    `insert into metrics_product_daily (day, taken_at, signups, active_users_24h, db_bytes) values ($1, $2, 3, 7, 12345)`,
    [utcDay(now - DAY), iso(now)]
  )
}

/** A grant with its own client (so several can exist for one user). Returns the grant id. */
async function grantFor(user, { adminUntil = null } = {}) {
  grantSeq += 1
  const client = `${CLIENT}_${grantSeq}`
  await db.pg.query(
    "insert into oauth_clients (client_id, kind, client_name, redirect_uris) values ($1, 'registered', 'Admin metrics test', $2)",
    [client, ['https://claude.ai/api/mcp/auth_callback']]
  )
  const { rows } = await db.pg.query(
    'insert into oauth_grants (user_id, client_id, scope, resource, admin_until) values ($1, $2, $3, $4, $5) returning id',
    [user.id, client, 'drafts', MCP, adminUntil]
  )
  return rows[0].id
}

/** The caller of an elevated admin grant, as resolveAccess builds it from a real access token. Made once per file. */
let callerOnce = null
function elevatedCaller() {
  callerOnce ??= (async () => {
    const grantId = await grantFor(admin, { adminUntil: new Date(Date.now() + DAY) })
    const pair = await issuePair(grantId)
    return await resolveAccess(pair.access_token, MCP)
  })()
  return callerOnce
}

/** A REST GET as `caller` running the named admin tool (the guard needs adminTool set). */
const restAs = (caller, toolName, path) => runAs({ ...caller, adminTool: toolName }, () => route(new Request(`${APP_URL}/api${path}`, { method: 'GET' })))

const getJson = async (caller, toolName, path) => {
  const res = await restAs(caller, toolName, path)
  return { status: res.status, body: res.status === 200 ? JSON.parse(await res.text()) : null }
}

describe('GET /admin/metrics: grouped rows', () => {
  it('groups by route, biggest count first, with percentiles that need their sample counts', async () => {
    const caller = await elevatedCaller()
    const { status, body } = await getJson(caller, 'admin_metrics', '/admin/metrics?window=24h&by=route')
    expect(status).toBe(200)
    expect(body.window).toEqual({ name: '24h', from: iso(hourOf(now) - 23 * HOUR), to: body.as_of })
    expect(body.metrics.map((m) => m.group)).toEqual([
      { route: 'GET /drafts/:id', op: '-', caller: 'all' },
      { route: 'GET /drafts', op: '-', caller: 'all' }
    ])

    const [first, second] = body.metrics
    // 25 + 1 samples: counter 13 holds 25 of 26 samples, so the p50 is 8 (capped at the max).
    expect(first).toMatchObject({
      name: 'latency',
      window: '24h',
      count: 26,
      errors: { '4xx': 2, '429': 1, '5xx': 1, tool_error: 0 },
      cold: 1,
      p50: 8,
      p90: null,
      p95: null,
      p99: null,
      p99_9: null,
      max: 8,
      unit: 'ms',
      source: 'app_rollup'
    })
    expect(first.mean).toBeCloseTo(204 / 26, 10)
    expect(first.low_samples).toEqual(['p90', 'p95', 'p99', 'p99_9'])

    // 10 samples are below the p50 minimum of 20, so every percentile is null.
    expect(second).toMatchObject({ count: 10, p50: null, p90: null, max: 16, mean: 16, cold: 0 })
    expect(second.low_samples).toEqual(['p50', 'p90', 'p95', 'p99', 'p99_9'])
  })

  it('the 1h window holds only the current UTC hour', async () => {
    const caller = await elevatedCaller()
    const { body } = await getJson(caller, 'admin_metrics', '/admin/metrics?window=1h&by=route')
    expect(body.window.from).toBe(iso(hourOf(now)))
    expect(body.metrics).toHaveLength(1)
    expect(body.metrics[0]).toMatchObject({ count: 1, p50: null, max: 4, group: { route: 'GET /drafts/:id' } })
  })

  it('the 30d window adds the daily row to the hourly rows', async () => {
    const caller = await elevatedCaller()
    const { body } = await getJson(caller, 'admin_metrics', '/admin/metrics?window=30d&by=route')
    const [first, second] = body.metrics
    // 26 hourly samples plus 100 daily samples; counter 13 holds 125 of 126, so the p90 (100 samples) is 8.
    expect(first).toMatchObject({ count: 126, p90: 8, max: 8, errors: { '4xx': 2, '429': 1, '5xx': 1, tool_error: 0 } })
    expect(first.mean).toBeCloseTo((204 + 800) / 126, 10)
    expect(first.low_samples).toEqual(['p95', 'p99', 'p99_9'])
    expect(second).toMatchObject({ count: 10, group: { route: 'GET /drafts' } })
  })

  it('by=caller and by=op group the same rows differently', async () => {
    const caller = await elevatedCaller()
    const byCaller = await getJson(caller, 'admin_metrics', '/admin/metrics?window=24h&by=caller')
    expect(byCaller.body.metrics.map((m) => [m.group.caller, m.count])).toEqual([
      ['web', 26],
      ['mcp:claude', 10]
    ])
    expect(byCaller.body.metrics[0].group).toEqual({ route: 'all', op: '-', caller: 'web' })

    const byOp = await getJson(caller, 'admin_metrics', '/admin/metrics?window=24h&by=op')
    expect(byOp.body.metrics).toHaveLength(1)
    expect(byOp.body.metrics[0]).toMatchObject({ count: 36, group: { route: 'all', op: '-', caller: 'all' } })
  })

  it('route filters to one route, or to unmatched (no rows here)', async () => {
    const caller = await elevatedCaller()
    const one = await getJson(caller, 'admin_metrics', '/admin/metrics?window=24h&route=GET%20%2Fdrafts')
    expect(one.body.metrics.map((m) => m.count)).toEqual([10])
    const none = await getJson(caller, 'admin_metrics', '/admin/metrics?window=24h&route=unmatched')
    expect(none.body.metrics).toEqual([])
  })

  it('answers 400 on bad parameters, and on a route that is not one of the app', async () => {
    const caller = await elevatedCaller()
    for (const path of [
      '/admin/metrics?window=2d',
      '/admin/metrics?by=user',
      '/admin/metrics?route=GET%20%2Fnope',
      '/admin/metrics?route=GET%20%2Fnope%2F%3Aid'
    ]) {
      expect((await restAs(caller, 'admin_metrics', path)).status, path).toBe(400)
    }
  })

  it('no answer contains a uuid', async () => {
    const caller = await elevatedCaller()
    const { body } = await getJson(caller, 'admin_metrics', '/admin/metrics?window=30d&by=all')
    expect(JSON.stringify(body)).not.toMatch(UUID)
  })
})

describe('GET /admin/metrics/series: points', () => {
  it('the 24h series has one point per hour, with zeros where nothing happened', async () => {
    const caller = await elevatedCaller()
    const { status, body } = await getJson(caller, 'admin_metrics_series', '/admin/metrics/series?name=requests&window=24h')
    expect(status).toBe(200)
    expect(body.grain).toBe('hour')
    expect(body.points).toHaveLength(24)
    expect(body.points.reduce((sum, p) => sum + p.value, 0)).toBe(36)
    const at = (ms) => body.points.find((p) => p.at === iso(ms))
    expect(at(hourOf(now) - HOUR)).toMatchObject({ value: 25, unit: 'count', source: 'app_rollup' })
    expect(at(hourOf(now) - 2 * HOUR)).toMatchObject({ value: 10 })
    expect(at(hourOf(now) - 5 * HOUR)).toMatchObject({ value: 0, p50: null })
  })

  it('a route narrows a request series, and the sum matches that route only', async () => {
    const caller = await elevatedCaller()
    const { body } = await getJson(caller, 'admin_metrics_series', '/admin/metrics/series?name=requests&window=24h&route=GET%20%2Fdrafts%2F%3Aid')
    expect(body.route).toBe('GET /drafts/:id')
    expect(body.points.reduce((sum, p) => sum + p.value, 0)).toBe(26)
  })

  it('the 30d series is daily and adds the daily row', async () => {
    const caller = await elevatedCaller()
    const { body } = await getJson(caller, 'admin_metrics_series', '/admin/metrics/series?name=requests&window=30d')
    expect(body.grain).toBe('day')
    expect(body.points.reduce((sum, p) => sum + p.value, 0)).toBe(136)
    expect(body.points.find((p) => p.at === `${utcDay(now - 20 * DAY)}T00:00:00.000Z`)).toMatchObject({ value: 100 })
  })

  it('a product series returns the daily number, null on days without a row, and taken_at for rolling numbers', async () => {
    const caller = await elevatedCaller()
    const signups = await getJson(caller, 'admin_metrics_series', '/admin/metrics/series?name=signups&window=7d')
    const yesterday = `${utcDay(now - DAY)}T00:00:00.000Z`
    expect(signups.body.points.find((p) => p.at === yesterday)).toMatchObject({ value: 3, taken_at: null, source: 'product_daily' })
    expect(signups.body.points.find((p) => p.at === `${utcDay(now)}T00:00:00.000Z`)).toMatchObject({ value: null })

    const active = await getJson(caller, 'admin_metrics_series', '/admin/metrics/series?name=active_users_24h&window=7d')
    expect(active.body.points.find((p) => p.at === yesterday)).toMatchObject({ value: 7, taken_at: iso(now) })

    const bytes = await getJson(caller, 'admin_metrics_series', '/admin/metrics/series?name=db_bytes&window=7d')
    expect(bytes.body.unit).toBe('bytes')
    expect(bytes.body.points.find((p) => p.at === yesterday)).toMatchObject({ value: 12345 })
  })

  it('answers 400 for an unknown name, a bad window, and a route on a product series', async () => {
    const caller = await elevatedCaller()
    for (const path of [
      '/admin/metrics/series',
      '/admin/metrics/series?name=users',
      '/admin/metrics/series?name=requests&window=1h',
      '/admin/metrics/series?name=signups&window=7d&route=GET%20%2Fdrafts',
      '/admin/metrics/series?name=requests&route=GET%20%2Fnope'
    ]) {
      expect((await restAs(caller, 'admin_metrics_series', path)).status, path).toBe(400)
    }
  })
})

describe('who may read it', () => {
  it('a caller without the admin tool, a signed-out request and the wrong tool get 404', async () => {
    const caller = await elevatedCaller()
    for (const path of ['/admin/metrics', '/admin/metrics/series?name=requests']) {
      const plain = await runAs({ ...caller, admin: false, adminTool: undefined }, () => route(new Request(`${APP_URL}/api${path}`)))
      expect(plain.status, path).toBe(404)
      const signedOut = await route(new Request(`${APP_URL}/api${path}`))
      expect(signedOut.status, path).toBe(404)
    }
    expect((await restAs(caller, 'admin_metrics', '/admin/metrics/series?name=requests')).status).toBe(404)
    expect((await restAs(caller, 'admin_metrics_series', '/admin/metrics?window=24h')).status).toBe(404)
  })

  it('both tools are in the admin tool list, and run their own route', async () => {
    const names = ADMIN_TOOLS.map((tool) => tool.name)
    expect(names).toEqual(expect.arrayContaining(['admin_metrics', 'admin_metrics_series']))
    const caller = await elevatedCaller()
    const paths = []
    const rest = (method, path) => {
      paths.push(`${method} ${path}`)
      return restAs(caller, 'admin_metrics', path)
    }
    const metrics = await ADMIN_TOOLS.find((tool) => tool.name === 'admin_metrics').run({ window: '24h', by: 'route' }, { rest })
    expect(metrics.status).toBe(200)
    expect(paths).toEqual(['GET /admin/metrics?window=24h&by=route'])
    const series = ADMIN_TOOLS.find((tool) => tool.name === 'admin_metrics_series')
    const seriesRun = await series.run({ name: 'requests', window: '24h' }, { rest: (method, path) => restAs(caller, 'admin_metrics_series', path) })
    expect(seriesRun.status).toBe(200)
  })
})

describe('the cache', () => {
  it('answers the same parameters from memory for a minute', async () => {
    const caller = await elevatedCaller()
    const first = await getJson(caller, 'admin_metrics', '/admin/metrics?window=24h&by=op')
    await db.pg.exec('delete from metrics_hourly')
    const second = await getJson(caller, 'admin_metrics', '/admin/metrics?window=24h&by=op')
    expect(second.body).toEqual(first.body)
    resetMetricsCacheForTests()
    const third = await getJson(caller, 'admin_metrics', '/admin/metrics?window=24h&by=op')
    expect(third.body.metrics).toEqual([])
  })
})
