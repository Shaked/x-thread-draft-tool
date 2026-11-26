// @vitest-environment node
// Central metrics M5 (#451): GET /api/admin/metrics/summary and /events, and the tools admin_metrics_summary and
// admin_metrics_events. Rows are seeded here, so each expected line is worked out by hand.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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
const REPO_ID = 1136002672
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

let db
let caller
let now

const iso = (ms) => new Date(ms).toISOString()
const hourOf = (ms) => Math.floor(ms / HOUR) * HOUR
const literal = (counts) => `{${counts.join(',')}}`

beforeAll(async () => {
  db = await setupTestDb()
  const admin = await db.insertUser({ github_id: 960015, login: 'shaked', name: 'Owner' })
  await db.pg.query("insert into oauth_clients (client_id, kind, client_name, redirect_uris) values ('xtc_summary_test', 'registered', 'Summary test', $1)", [['https://claude.ai/api/mcp/auth_callback']])
  const { rows } = await db.pg.query(
    "insert into oauth_grants (user_id, client_id, scope, resource, admin_until) values ($1, 'xtc_summary_test', 'drafts', $2, $3) returning id",
    [admin.id, MCP, iso(Date.now() + DAY)]
  )
  caller = await resolveAccess((await issuePair(rows[0].id)).access_token, MCP)
})

async function event(id, ago, { source, kind, name, status, ms = null, attrs = {}, link = null }) {
  await db.pg.query(
    'insert into ops_events (repo_id, source, kind, id, at, name, status, ms, attrs, link) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
    [REPO_ID, source, kind, id, iso(now - ago), name, status, ms, JSON.stringify(attrs), link]
  )
}

const merge = (id, ago, ms, status) => event(id, ago, { source: 'speed', kind: 'merge', name: 'total', status, ms, attrs: { limit_ms: 150000 } })
const run = (id, ago, status, extra = {}) => event(id, ago, { source: 'ci', kind: 'run', name: 'Tests', status, ...extra })

beforeEach(async () => {
  await db.pg.exec('delete from ops_events; delete from metrics_hourly; delete from metrics_daily')
  resetMetricsCacheForTests()
  now = Date.now()
  // 35 requests in the last hours, one server error, spread over two groups.
  const rows = [
    [hourOf(now) - HOUR, 'GET /drafts/:id', 25, 1],
    [hourOf(now) - 2 * HOUR, 'GET /drafts', 10, 0]
  ]
  for (const [hour, routeKey, n, n5xx] of rows) {
    await db.pg.query(
      `insert into metrics_hourly (hour, route, op, caller, n, n_5xx, sum_ms, max_ms, buckets) values ($1, $2, '-', 'web', $3, $4, $5, 8, $6)`,
      [iso(hour), routeKey, n, n5xx, n * 8, literal(oneHot(8).map((v) => v * n))]
    )
  }
})

const restAs = (toolName, path, who = caller) => runAs({ ...who, adminTool: toolName }, () => route(new Request(`${APP_URL}/api${path}`)))
const getJson = async (toolName, path) => {
  const res = await restAs(toolName, path)
  return { status: res.status, body: res.status === 200 ? JSON.parse(await res.text()) : null }
}

async function seedDelivery() {
  // Speed: three merges in the window (p90 is the slowest, 200 s), two over the 150 s limit; one merge last week.
  await merge('m1', 3 * HOUR, 100000, 'ok')
  await merge('m2', 2 * HOUR, 200000, 'over')
  await merge('m3', HOUR, 160000, 'over')
  await merge('m0', 3 * DAY, 120000, 'ok')
  // CI: three green and one red run now; one green and one red run last week.
  await run('r1', 4 * HOUR, 'success')
  await run('r2', 3 * HOUR, 'success')
  await run('r3', 2 * HOUR, 'success')
  await run('r4', HOUR + 1000, 'failure', { attrs: { failed_step: 'Install Playwright browsers' }, link: 'https://github.com/Shaked/x-thread-draft-tool/actions/runs/1' })
  await run('r5', 3 * DAY, 'success')
  await run('r6', 3 * DAY + HOUR, 'failure')
  // Deploys: two to production, 22 s each.
  await event('d1', 2 * HOUR, { source: 'deploy', kind: 'deploy', name: 'Production', status: 'success', ms: 22000 })
  await event('d2', HOUR - 60000, { source: 'deploy', kind: 'deploy', name: 'Production', status: 'success', ms: 22000 })
}

describe('GET /admin/metrics/summary', () => {
  it('says the number, the limit, last week and since when, one line each', async () => {
    await seedDelivery()
    const { status, body } = await getJson('admin_metrics_summary', '/admin/metrics/summary')
    expect(status).toBe(200)
    const lines = body.text.split('\n')
    expect(lines[0]).toMatch(/^Metrics summary for Shaked\/x-thread-draft-tool, last 24 hours, as of \d{4}-\d\d-\d\d \d\d:\d\d UTC \(events up to /)
    expect(lines[1]).toBe(
      `- Speed: 1 in 10 merges took 3 min 20 s or more from push to tested production. Limit 2 min 30 s. Last week 2 min. ` +
        `Over since ${iso(now - 2 * HOUR).slice(0, 16).replace('T', ' ')} UTC (2 merges).`
    )
    expect(lines[2]).toBe(
      '- CI checks: 4 runs, 1 failed (25 %). Last week 50 %. Most failures: Tests, step "Install Playwright browsers" (1). ' +
        'Last failure: https://github.com/Shaked/x-thread-draft-tool/actions/runs/1'
    )
    expect(lines[3]).toBe('- Deploys: 2 to production, none failed. Median 22 s from deploy start to live. Last week no data.')
    expect(lines[4]).toBe('- Production: 35 requests, 1 server errors. Slowest 5 %: too few requests to say.')
    expect(lines[5]).toMatch(/^- Database: \d+ MB of 1 GB \(\d+ %\)\.$/)
    expect(lines[6]).toBe('Nothing else is over its limit.')
    expect(body.findings.map((f) => f.area)).toEqual(['speed', 'ci', 'deploys', 'production', 'database'])
    expect(body.findings[0]).toMatchObject({ value: 200, unit: 's', limit: 150, baseline: 120, over: true, count_over: 2, since: iso(now - 2 * HOUR) })
    expect(body.findings[1]).toMatchObject({ value: 25, unit: '%', baseline: 50, over: false })
    expect(body.events_until).toBe(iso(now - HOUR + 60000))
  })

  it('says "Nothing is over its limit." when it is true', async () => {
    await merge('m1', HOUR, 100000, 'ok')
    const { body } = await getJson('admin_metrics_summary', '/admin/metrics/summary?window=7d')
    expect(body.text.split('\n').at(-1)).toBe('Nothing is over its limit.')
    expect(body.text).toContain('last 7 days')
    expect(body.text).toContain('Speed: 1 in 10 merges took 1 min 40 s or more')
    expect(body.findings.every((f) => !f.over)).toBe(true)
  })

  it('the first line says so when the events are older than 7 hours', async () => {
    await merge('m1', 10 * HOUR, 100000, 'ok')
    const { body } = await getJson('admin_metrics_summary', '/admin/metrics/summary')
    expect(body.text.split('\n')[0]).toBe(
      `Delivery events are old: the last one is from ${iso(now - 10 * HOUR).slice(0, 16).replace('T', ' ')} UTC. ` +
        'Run https://github.com/Shaked/x-thread-draft-tool/actions/workflows/metrics-daily.yml by hand.'
    )
  })

  it('a production error does not make stale delivery events look fresh', async () => {
    await merge('m1', 10 * HOUR, 100000, 'ok')
    await event('e1', 60000, { source: 'prod', kind: 'error', name: 'GET /drafts', status: '500' })
    const { body } = await getJson('admin_metrics_summary', '/admin/metrics/summary')
    expect(body.events_until).toBe(iso(now - 10 * HOUR))
    expect(body.text.split('\n')[0]).toMatch(/^Delivery events are old/)
  })

  it('judges code and docs merges against their own limits', async () => {
    await merge('c1', 3 * HOUR, 140000, 'ok')
    await event('dm', HOUR, { source: 'speed', kind: 'merge', name: 'total', status: 'ok', ms: 40000, attrs: { limit_ms: 90000 } })
    const { body } = await getJson('admin_metrics_summary', '/admin/metrics/summary')
    expect(body.findings[0]).toMatchObject({ over: false, value: 140, limit: 150 })
  })

  it('the deploy median counts successful deploys only', async () => {
    await event('f1', 3 * HOUR, { source: 'deploy', kind: 'deploy', name: 'Production', status: 'failure', ms: 1000 })
    await event('f2', 2 * HOUR, { source: 'deploy', kind: 'deploy', name: 'Production', status: 'failure', ms: 1000 })
    await event('s1', HOUR, { source: 'deploy', kind: 'deploy', name: 'Production', status: 'success', ms: 60000 })
    const { body } = await getJson('admin_metrics_summary', '/admin/metrics/summary')
    expect(body.text).toContain('Deploys: 3 to production, 2 failed. Median 1 min from deploy start to live.')
  })

  it('has no data: every line still answers', async () => {
    await db.pg.exec('delete from metrics_hourly')
    const { body } = await getJson('admin_metrics_summary', '/admin/metrics/summary')
    expect(body.events_until).toBeNull()
    const lines = body.text.split('\n')
    expect(lines[0]).toMatch(/^No delivery events yet\. Run https:\/\/github\.com\/.*metrics-daily\.yml by hand\.$/)
    expect(lines.slice(2, 6)).toEqual([
      '- Speed: no merges in this window.',
      '- CI checks: no runs in this window.',
      '- Deploys: none to production in this window.',
      '- Production: no requests in this window.'
    ])
  })

  it('the Production numbers equal GET /admin/metrics for the same window', async () => {
    const summary = (await getJson('admin_metrics_summary', '/admin/metrics/summary?window=24h')).body
    const metrics = (await getJson('admin_metrics', '/admin/metrics?window=24h&by=total')).body.metrics[0]
    expect(summary.text).toContain(`Production: ${metrics.count} requests, ${metrics.errors['5xx']} server errors.`)
    expect(metrics).toMatchObject({ count: 35, errors: { '5xx': 1 } })
  })

  it('refuses a window or a repo it does not know', async () => {
    for (const path of ['?window=30d', '?window=1h', '?repo=someone/else', '?repo=']) {
      expect((await restAs('admin_metrics_summary', `/admin/metrics/summary${path}`)).status, path).toBe(400)
    }
  })
})

describe('GET /admin/metrics/events', () => {
  it('lists newest first and filters by source, kind, status, name and since', async () => {
    await seedDelivery()
    const all = (await getJson('admin_metrics_events', '/admin/metrics/events')).body
    expect(all.count).toBe(12)
    expect(all.events.map((e) => e.at)).toEqual([...all.events.map((e) => e.at)].sort().reverse())
    const failed = (await getJson('admin_metrics_events', '/admin/metrics/events?source=ci&kind=run&status=failure&name=Tests')).body
    expect(failed.events.map((e) => e.id)).toEqual(['r4', 'r6'])
    expect(failed.text.split('\n')[0]).toMatch(/ ci\/run Tests failure https:\/\/github\.com\/Shaked\/x-thread-draft-tool\/actions\/runs\/1$/)
    const recent = (await getJson('admin_metrics_events', `/admin/metrics/events?since=${encodeURIComponent(iso(now - 2.5 * HOUR))}&limit=2`)).body
    expect(recent.events.map((e) => e.id)).toEqual(['d2', 'm3'])
  })

  it('says so when nothing matches, and refuses bad parameters', async () => {
    expect((await getJson('admin_metrics_events', '/admin/metrics/events?source=nope')).body.text).toBe('No events match.')
    for (const path of ['?limit=0', '?limit=101', '?limit=x', '?since=yesterday', '?source=', `?name=${'x'.repeat(121)}`]) {
      expect((await restAs('admin_metrics_events', `/admin/metrics/events${path}`)).status, path).toBe(400)
    }
  })
})

describe('who may read it, and the tools', () => {
  it('a caller without the admin tool, a signed-out request and the wrong tool get 404', async () => {
    for (const path of ['/admin/metrics/summary', '/admin/metrics/events']) {
      const plain = await runAs({ ...caller, admin: false, adminTool: undefined }, () => route(new Request(`${APP_URL}/api${path}`)))
      expect(plain.status, path).toBe(404)
      expect((await route(new Request(`${APP_URL}/api${path}`))).status, path).toBe(404)
    }
    expect((await restAs('admin_metrics', '/admin/metrics/summary')).status).toBe(404)
    expect((await restAs('admin_metrics_summary', '/admin/metrics/events')).status).toBe(404)
  })

  it('each tool runs its own route, and its text is the REST text', async () => {
    await seedDelivery()
    const paths = []
    for (const [name, args, path] of [
      ['admin_metrics_summary', { window: '24h' }, '/admin/metrics/summary?window=24h'],
      ['admin_metrics_events', { source: 'ci', limit: 5 }, '/admin/metrics/events?source=ci&limit=5']
    ]) {
      const tool = ADMIN_TOOLS.find((t) => t.name === name)
      const res = await tool.run(args, { rest: (method, p) => (paths.push(`${method} ${p}`), restAs(name, p)) })
      expect(paths.at(-1)).toBe(`GET ${path}`)
      const viaTool = JSON.parse(await res.text())
      const viaRest = (await getJson(name, path)).body
      expect(viaTool.text).toBe(viaRest.text)
    }
  })
})
