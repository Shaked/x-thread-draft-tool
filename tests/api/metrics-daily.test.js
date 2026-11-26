// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose'
import { ciAudience, OIDC_ISSUER, OPS_WORKFLOW_PATH, opsDailyAudience, opsEventsAudience, setJwksForTests } from '../../server/oidc-ci.js'
import { opsPathOpen } from '../../server/routes/ops.js'
import { route } from '../../server/router.js'
import { runDailyStep } from '../../server/metrics/daily.js'
import { setupTestDb } from './helpers/db.js'

// Central metrics O5 (#336): POST /api/ops/metrics-daily, the /ops gate, its token and the retention rules.
const REPO_ID = 1136002672
const OPS_REF = `Shaked/x-thread-draft-tool/${OPS_WORKFLOW_PATH}@refs/heads/main`
const ENV = { CI_OIDC_ENABLED: '1', VERCEL_ENV: 'preview', CI_OIDC_REPOSITORY_ID: String(REPO_ID) }
const BASE = 'https://app.test/api'
const NOW = Date.parse('2026-11-26T00:30:00Z')

let db
let signingKey
const kid = 'ops-daily-test-kid'

beforeAll(async () => {
  db = await setupTestDb()
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  signingKey = privateKey
  setJwksForTests(createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' }] }))
  Object.assign(process.env, ENV)
})

beforeEach(async () => {
  await db.pg.exec(`delete from metrics_hourly; delete from metrics_daily; delete from metrics_product_daily;
    delete from ops_events; delete from ops_daily; delete from ops_cursor; delete from admin_audit;
    delete from users;`)
})

const query = (text, params) => db.pg.query(text, params)
const zeros = 'array_fill(0, array[65])'

function claims(overrides = {}) {
  return {
    repository_id: String(REPO_ID),
    workflow_ref: OPS_REF,
    job_workflow_ref: OPS_REF,
    event_name: 'schedule',
    ref: 'refs/heads/main',
    runner_environment: 'github-hosted',
    ...overrides
  }
}

async function mint(body = {}, { aud = opsDailyAudience('preview') } = {}) {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT(claims(body))
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(OIDC_ISSUER)
    .setAudience(aud)
    .setSubject('repo:Shaked/x-thread-draft-tool:ref:refs/heads/main')
    .setNotBefore(now - 5)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(signingKey)
}

async function post(path, token, { method = 'POST' } = {}) {
  const headers = {}
  if (token) headers.authorization = `Bearer ${token}`
  return route(new Request(`${BASE}${path}`, { method, headers }))
}

async function hourlyRow(hour, x, { route: r = '/drafts', op = 'get', caller = 'web', max = 5, ms = 10 } = {}) {
  const buckets = Array.from({ length: 65 }, (_, i) => (i + 1) * x)
  await query(
    `insert into metrics_hourly (hour, route, op, caller, n, n_3xx, n_4xx, n_429, n_5xx, n_tool_error, sum_ms, max_ms,
       sum_db_ms, sum_q, sum_conn, cold, buckets)
     values ($1::timestamptz, $2, $3, $4, $5, 0, 0, 0, 0, 0, $6, $7, 0, 0, 0, 0, $8::int[])`,
    [hour, r, op, caller, x, ms * x, max, buckets]
  )
}

async function countOf(table) {
  return (await query(`select count(*)::int as n from ${table}`)).rows[0].n
}

describe('runDailyStep: the product row', () => {
  it('writes yesterday once; a second run writes nothing', async () => {
    const first = await runDailyStep({ now: NOW })
    expect(first.product_day_written).toBe(1)
    const second = await runDailyStep({ now: NOW })
    expect(second.product_day_written).toBe(0)
    const rows = await query('select day::text as day from metrics_product_daily')
    expect(rows.rows).toEqual([{ day: '2026-11-25' }])
  })

  it('counts the calendar day from columns that never change', async () => {
    const inDay = '2026-11-25T10:00:00Z'
    const { rows } = await query(
      `insert into users (github_id, login, created_at, suspended_at) values (1, 'a', $1, null), (2, 'b', $1, now()) returning id`,
      [inDay]
    )
    await query(`insert into drafts (user_id, created_at, updated_at) values ($1, $2, $2)`, [rows[0].id, inDay])
    await runDailyStep({ now: NOW })
    const day = (await query('select * from metrics_product_daily')).rows[0]
    expect(day.signups).toBe(2)
    expect(day.drafts_created).toBe(1)
    expect(day.admin_actions_done).toBe(0)
  })

  it('stores null rolling counts for a late run, and numbers for an on-time one', async () => {
    await runDailyStep({ now: Date.parse('2026-11-26T12:00:00Z') })
    const late = (await query('select active_users_24h, active_users_7d, suspended_users, db_bytes from metrics_product_daily')).rows[0]
    expect(late).toEqual({ active_users_24h: null, active_users_7d: null, suspended_users: null, db_bytes: null })
    await db.pg.exec('delete from metrics_product_daily')
    await runDailyStep({ now: Date.parse('2026-11-26T01:00:00Z') })
    const onTime = (await query('select active_users_24h, suspended_users, db_bytes from metrics_product_daily')).rows[0]
    expect(onTime.active_users_24h).toBe(0)
    expect(onTime.suspended_users).toBe(0)
    expect(Number(onTime.db_bytes)).toBeGreaterThan(0)
  })
})

describe('runDailyStep: the hourly move', () => {
  it('moves hourly rows older than 14 days, sums them exactly and keeps newer ones', async () => {
    await hourlyRow('2026-11-01T00:00:00Z', 2, { max: 7, ms: 10 })
    await hourlyRow('2026-11-01T01:00:00Z', 3, { max: 9, ms: 20 })
    await hourlyRow('2026-11-25T23:00:00Z', 4)
    const result = await runDailyStep({ now: NOW })
    expect(result.hourly_moved).toBe(2)
    expect(await countOf('metrics_hourly')).toBe(1)
    const row = (await query("select n, max_ms, sum_ms, buckets from metrics_daily where day = '2026-11-01'")).rows[0]
    expect(row.n).toBe(5)
    expect(row.max_ms).toBe(9)
    expect(row.sum_ms).toBe(10 * 2 + 20 * 3)
    expect(row.buckets[0]).toBe(5)
    expect(row.buckets[64]).toBe(65 * 5)
  })

  it('adds to a day already in metrics_daily when a later run moves more hours of it', async () => {
    await hourlyRow('2026-11-01T00:00:00Z', 2, { max: 7, ms: 10 })
    await runDailyStep({ now: NOW })
    await hourlyRow('2026-11-01T05:00:00Z', 3, { max: 9, ms: 20 })
    await runDailyStep({ now: NOW })
    const row = (await query("select n, max_ms, sum_ms, buckets from metrics_daily where day = '2026-11-01'")).rows[0]
    expect(row.n).toBe(5)
    expect(row.max_ms).toBe(9)
    expect(row.sum_ms).toBe(10 * 2 + 20 * 3)
    expect(row.buckets[0]).toBe(5)
    expect(row.buckets[64]).toBe(65 * 5)
  })

  it('a second run moves nothing and does not count twice', async () => {
    await hourlyRow('2026-11-01T00:00:00Z', 2)
    await runDailyStep({ now: NOW })
    const again = await runDailyStep({ now: NOW })
    expect(again.hourly_moved).toBe(0)
    expect((await query("select n from metrics_daily where day = '2026-11-01'")).rows[0].n).toBe(2)
  })

  it('two runs started together do not double-count', async () => {
    await hourlyRow('2026-11-01T00:00:00Z', 2)
    await Promise.all([runDailyStep({ now: NOW }), runDailyStep({ now: NOW })])
    expect((await query("select n from metrics_daily where day = '2026-11-01'")).rows[0].n).toBe(2)
    expect(await countOf('metrics_hourly')).toBe(0)
  })
})

describe('runDailyStep: retention deletes metric rows only', () => {
  it('drops metrics_daily past 400 days, ops_events past 14 days and ops_daily past 400 days', async () => {
    await query(`insert into metrics_daily (day, route, op, caller, buckets) values ('2025-10-10', '/x', 'o', 'c', ${zeros}), ('2025-11-30', '/x', 'o', 'c', ${zeros})`)
    await query(
      `insert into ops_events (repo_id, source, kind, id, at, name, status) values
       (1, 'ci', 'run', 'old', '2026-11-01T00:00:00Z', 'n', 's'), (1, 'ci', 'run', 'new', '2026-11-20T00:00:00Z', 'n', 's')`
    )
    await query(
      `insert into ops_daily (day, repo_id, source, kind, name, status, count) values
       ('2025-10-10', 1, 'ci', 'run', 'n', 'skipped', 1), ('2025-11-30', 1, 'ci', 'run', 'n', 'skipped', 1)`
    )
    await query(`insert into ops_cursor (repo_id, completed_at) values (1, '2026-11-20T00:00:00Z')`)

    const result = await runDailyStep({ now: NOW })
    expect(result).toMatchObject({ daily_deleted: 1, ops_events_deleted: 1, ops_daily_deleted: 1 })
    expect((await query('select day::text as d from metrics_daily')).rows).toEqual([{ d: '2025-11-30' }])
    expect((await query('select id from ops_events')).rows).toEqual([{ id: 'new' }])
    expect((await query('select day::text as d from ops_daily')).rows).toEqual([{ d: '2025-11-30' }])
    expect(await countOf('ops_cursor')).toBe(1)
  })

  it('changes no user table row', async () => {
    await query(`insert into users (github_id, login) values (1, 'a')`)
    const before = await query('select (select count(*) from users)::int as u, (select count(*) from admin_audit)::int as a')
    await runDailyStep({ now: NOW })
    const after = await query('select (select count(*) from users)::int as u, (select count(*) from admin_audit)::int as a')
    expect(after.rows).toEqual(before.rows)
  })
})

describe('POST /api/ops/metrics-daily: who may run the daily step', () => {
  it('answers counts to the daily token', async () => {
    const res = await post('/ops/metrics-daily', await mint())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Object.keys(body).sort()).toEqual(
      ['daily_deleted', 'hourly_moved', 'ops_daily_deleted', 'ops_events_deleted', 'product_day_written'].sort()
    )
  })

  it('answers 404 to every other caller and method: no token, the events token, CI, the other environment, another ref or workflow', async () => {
    const refused = [
      await post('/ops/metrics-daily', null),
      await post('/ops/metrics-daily', await mint({}, { aud: opsEventsAudience('preview') })),
      await post('/ops/metrics-daily', await mint({}, { aud: ciAudience('preview') })),
      await post('/ops/metrics-daily', await mint({}, { aud: opsDailyAudience('production') })),
      await post('/ops/metrics-daily', await mint({ ref: 'refs/heads/claude/x' })),
      await post('/ops/metrics-daily', await mint({ event_name: 'pull_request' })),
      await post('/ops/metrics-daily', await mint({ workflow_ref: `Shaked/x-thread-draft-tool/.github/workflows/smoke-deployed.yml@refs/heads/main`, job_workflow_ref: `Shaked/x-thread-draft-tool/.github/workflows/smoke-deployed.yml@refs/heads/main` })),
      await post('/ops/metrics-daily', await mint(), { method: 'GET' }),
      await post('/ops/metrics-daily', 'xt_not_a_jwt_token_value')
    ]
    for (const res of refused) expect(res.status).toBe(404)
  })

  it('refuses a token on another ops route: the daily token on /ops/events, the events token here', async () => {
    expect((await post('/ops/events', await mint())).status).toBe(404)
    expect((await post('/ops/metrics-daily', await mint({}, { aud: opsEventsAudience('preview') }))).status).toBe(404)
  })

  it('refuses the daily token on a CI route with 401, as every ops token', async () => {
    const res = await route(new Request(`${BASE}/drafts`, { headers: { authorization: `Bearer ${await mint()}` } }))
    expect(res.status).toBe(401)
  })
})

describe('opsPathOpen: the /ops gate', () => {
  it('returns exactly false for a caller that is not the metrics-daily workflow', async () => {
    const plain = new Request(`${BASE}/ops/metrics-daily`, { method: 'POST' })
    expect(await opsPathOpen(plain, '/ops/metrics-daily')).toBe(false)
    const wrongPath = new Request(`${BASE}/ops/other`, { method: 'POST', headers: { authorization: `Bearer ${await mint()}` } })
    expect(await opsPathOpen(wrongPath, '/ops/other')).toBe(false)
    const drafts = new Request(`${BASE}/drafts`, { method: 'POST', headers: { authorization: `Bearer ${await mint()}` } })
    expect(await opsPathOpen(drafts, '/drafts')).toBe(false)
  })

  it('returns exactly true for the metrics-daily token on its own path', async () => {
    const req = new Request(`${BASE}/ops/metrics-daily`, { method: 'POST', headers: { authorization: `Bearer ${await mint()}` } })
    expect(await opsPathOpen(req, '/ops/metrics-daily')).toBe(true)
  })
})
