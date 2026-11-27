// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { LIMITS, runAlerts } from '../../server/metrics/alerts.js'
import { runDailyStep } from '../../server/metrics/daily.js'
import { buildMessage } from '../../scripts/notify-telegram.mjs'
import { lint } from '../../scripts/reply-lint.mjs'
import { setupTestDb } from './helpers/db.js'

// Observability O7 (#338): the three alerts, the state that sends each one once, and the message text.
const NOW = Date.parse('2026-11-26T12:30:00Z')
const HOUR = '2026-11-26T12:00:00Z'
const MB = 1024 * 1024
let db

beforeAll(async () => {
  db = await setupTestDb()
})

beforeEach(async () => {
  await db.pg.exec('delete from metrics_hourly; delete from metrics_product_daily; delete from ops_events; delete from metrics_alert_state;')
})

const query = (text, params) => db.pg.query(text, params)
const run = (opts = {}) => runAlerts(query, { now: NOW, dbBytes: 100 * MB, ...opts })

// One hourly row: n requests, e of them 5xx, r of them 429, all in histogram counter `k`.
async function row({ hour = HOUR, route = 'GET /drafts', n = 0, e = 0, r = 0, k = 5 } = {}) {
  const buckets = Array.from({ length: 65 }, (_, i) => (i === k ? n : 0))
  await query(
    `insert into metrics_hourly (hour, route, op, caller, n, n_5xx, n_429, sum_ms, max_ms, buckets)
     values ($1::timestamptz, $2, 'x', 'web', $3, $4, $5, $3 * 1000, 5000, $6::int[])`,
    [hour, route, n, e, r, buckets]
  )
}
const kinds = (alerts) => alerts.map((a) => a.kind)

describe('A1 errors: 5xx at least 2 % of requests and at least 10 of them, last 6 hours', () => {
  it('fires just over, not just under', async () => {
    await row({ n: 500, e: 10 })
    expect(kinds(await run())).toEqual(['errors'])
    await db.pg.exec('delete from metrics_hourly; delete from metrics_alert_state;')
    await row({ n: 500, e: 9 })
    expect(await run()).toEqual([])
    await db.pg.exec('delete from metrics_hourly;')
    await row({ n: 1000, e: 19 }) // 1.9 %
    expect(await run()).toEqual([])
  })

  it('ignores rows older than 6 hours, and says the route, the rate and the usual rate', async () => {
    await row({ hour: '2026-11-26T05:00:00Z', n: 100, e: 100 })
    expect(await run()).toEqual([])
    await row({ hour: '2026-11-24T05:00:00Z', n: 1000, e: 1 })
    await row({ route: 'POST /drafts', n: 100, e: 12 })
    const [alert] = await run()
    expect(alert.numberLine).toContain('12 of 100 requests (12 %)')
    expect(alert.numberLine).toContain('usual 9.2 %')
    expect(alert.numberLine).toContain('since 2026-11-26 12:30 UTC')
    expect(alert.causeLine).toBe('Likely cause: POST /drafts has 12 of the 12 errors.')
  })
})

describe('A2 slow: p95 of all routes over 1 000 ms with at least 200 samples, last 24 hours', () => {
  it('fires just over, not just under, and needs 200 samples', async () => {
    await row({ n: 200, k: 41 }) // counter 41 is about 1 117 ms
    expect(kinds(await run())).toEqual(['slow'])
    await db.pg.exec('delete from metrics_hourly; delete from metrics_alert_state;')
    await row({ n: 200, k: 40 }) // about 939 ms
    expect(await run()).toEqual([])
    await db.pg.exec('delete from metrics_hourly;')
    await row({ n: 199, k: 41 })
    expect(await run()).toEqual([])
  })

  it('names the limit, the usual value and the route that used the most time', async () => {
    await row({ hour: '2026-11-22T10:00:00Z', n: 300, k: 20 })
    await row({ n: 250, k: 41, route: 'GET /slow' })
    const [alert] = await run()
    expect(alert.numberLine).toMatch(/took 1117 ms or more in 24 hours\. The limit is 1000 ms \(12 % over\), usual \d+ ms, since/)
    expect(alert.causeLine).toMatch(/^Likely cause: GET \/slow used the most request time/)
  })
})

describe('A3 capacity: database over 700 MB, n_429 over 100 in 24 hours, ops_events over 100 000 rows', () => {
  it('the database fires just over 700 MB, not at it', async () => {
    expect(await run({ dbBytes: LIMITS.capacityBytes })).toEqual([])
    const [alert] = await run({ dbBytes: LIMITS.capacityBytes + 1 })
    expect(alert.kind).toBe('capacity')
    expect(alert.numberLine).toContain('The limit is 700 MB')
    expect(alert.actionLine).toMatch(/^Needs you:/)
  })

  it('n_429 fires at 101, not at 100, with refused tool calls counted in the same column', async () => {
    await row({ n: 100, r: 100 })
    expect(await run()).toEqual([])
    await db.pg.exec('delete from metrics_hourly;')
    await row({ n: 101, r: 101 })
    const [alert] = await run()
    expect(alert.causeLine).toBe('Likely cause: GET /drafts had 101 of them.')
  })

  it('the ops_events limit is 100 000 rows', () => {
    expect(LIMITS.capacityOpsRows).toBe(100000)
  })

  it('ops_events fires over the limit by count, not at it', async () => {
    // The real limit (100 000) is pinned above. The boundary is tested with a limit of 100 rows, so the test stays fast.
    const limits = { ...LIMITS, capacityOpsRows: 100 }
    const insert = (count) =>
      query(
        `insert into ops_events (repo_id, source, kind, id, at, name, status)
         select 1, 'ci', 'run', 'x' || g, now(), 'n', 'ok' from generate_series(1, $1::int) g`,
        [count]
      )
    await insert(100)
    expect(await run({ limits })).toEqual([])
    await query("insert into ops_events (repo_id, source, kind, id, at, name, status) values (1, 'ci', 'run', 'last', now(), 'n', 'ok')")
    const [alert] = await run({ limits })
    expect(alert.numberLine).toContain('ops_events holds 101 rows')
    expect(alert.numberLine).toContain('The limit is 100 ')
  })
})

describe('one problem, one message', () => {
  it('an alert that keeps firing for 48 hours is returned once', async () => {
    // A row in every window, so the alert fires on every run.
    const results = []
    for (let h = 0; h <= 48; h += 6) {
      await row({ hour: new Date(Math.floor((NOW + h * 3600e3) / 3600e3) * 3600e3).toISOString(), n: 500, e: 50 })
      results.push(kinds(await run({ now: NOW + h * 3600e3 })))
    }
    expect(results[0]).toEqual(['errors'])
    expect(results.slice(1).flat()).toEqual([])
    // It kept firing: the spell started at the first run and was last seen at the last one.
    const state = (await query('select first_seen, last_sent from metrics_alert_state where kind = $1', ['errors'])).rows[0]
    expect(new Date(state.first_seen).getTime()).toBe(NOW)
    expect(new Date(state.last_sent).getTime()).toBe(NOW + 48 * 3600e3)
  })

  it('a clear day resets it', async () => {
    await row({ n: 500, e: 50 })
    expect(kinds(await run())).toEqual(['errors'])
    await db.pg.exec('delete from metrics_hourly;')
    expect(await run({ now: NOW + 30 * 3600e3 })).toEqual([])
    await row({ hour: '2026-11-27T21:00:00Z', n: 500, e: 50 })
    expect(kinds(await run({ now: NOW + 36 * 3600e3 }))).toEqual(['errors'])
  })

  it('does not send again when the alert comes back inside 24 hours', async () => {
    await row({ n: 500, e: 50 })
    expect(kinds(await run())).toHaveLength(1)
    await db.pg.exec('delete from metrics_hourly;')
    await run({ now: NOW + 6 * 3600e3 })
    await row({ hour: '2026-11-26T19:00:00Z', n: 500, e: 50 })
    expect(await run({ now: NOW + 8 * 3600e3 })).toEqual([])
  })

  it('the daily step returns the new alerts and nothing on a second call', async () => {
    await row({ n: 500, e: 50 })
    const first = await runDailyStep({ now: NOW })
    expect(kinds(first.alerts)).toEqual(['errors'])
    expect((await runDailyStep({ now: NOW })).alerts).toEqual([])
  })
})

describe('the message', () => {
  it('passes the Telegram lint for each kind, with a fixture app name that is not hard coded', async () => {
    await row({ n: 500, e: 50 })
    await row({ n: 250, k: 41, route: 'GET /slow' })
    const alerts = await run({ dbBytes: LIMITS.capacityBytes + 1 })
    expect(kinds(alerts)).toEqual(['errors', 'slow', 'capacity'])
    const app = { name: 'Recipe Box', repoUrl: 'https://github.com/acme/recipe-box', siteUrl: 'https://recipe-box.example.com', previewUrl: 'https://recipe-box.example.com' }
    for (const alert of alerts) {
      const msg = buildMessage('metrics', alert, app)
      const lines = msg.plain.split('\n')
      expect(lines.length).toBeLessThanOrEqual(5)
      expect(lines[0]).toBe(`🚨 Recipe Box · ${alert.headline}: https://recipe-box.example.com/admin/metrics`)
      expect(msg.html).not.toMatch(/Thread Draft/)
      const markdown = msg.html
        .replace(/<b>([^<]+)<\/b>/g, '**$1**')
        .replace(/<a href="([^"]+)">([^<]+)<\/a>/g, '[$2]($1)')
      expect(lint(markdown, { kind: 'telegram', app: 'Recipe Box' }), markdown).toEqual([])
    }
  })
})
