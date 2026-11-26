// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupTestDb, apiRequest } from './helpers/db.js'
import { route } from '../../server/router.js'
import { setQueryImpl } from '../../server/db.js'
import { flushMetrics, resetErrorBudgetForTests } from '../../server/metrics/record.js'

// Central metrics plan M4 (#450): one prod/error event per 5xx answer, with the detail of that error only.
// The event must never hold a message, a path, an id or a user id; every 5xx count is metrics_hourly.n_5xx.
const SECRET = 'secret-message /home/user/private/9731 tok_abc123'
const DRAFT_ID = '33333333-3333-4333-8333-333333333333'

let db
let cookie
let userId
let original

// Makes the draft lookup throw after the session lookup has run, so the request already used SQL (q > 0).
function failDraftLookup(error = Object.assign(new Error(SECRET), { name: 'DraftStoreError', code: '23505' })) {
  setQueryImpl(async (text, params = []) => {
    if (text.includes('drafts where id')) throw error
    return original(text, params)
  })
}

const events = async () => (await db.pg.query("select * from ops_events where source = 'prod' order by at")).rows
const metricRows = async () => (await db.pg.query('select * from metrics_hourly')).rows
const lookup = () => apiRequest(`/api/drafts/${DRAFT_ID}`, { cookie })

beforeAll(async () => {
  db = await setupTestDb()
  original = async (text, params = []) => {
    const result = await db.pg.query(text, params)
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length }
  }
  const alice = await db.insertUser({ github_id: 91, login: 'errors-test' })
  userId = alice.id
  cookie = await db.cookieFor(alice)
})

beforeEach(async () => {
  process.env.METRICS_DISABLED = '0'
  process.env.VERCEL_ENV = 'production'
  await flushMetrics()
  await db.pg.exec('delete from metrics_hourly; delete from ops_events;')
  resetErrorBudgetForTests()
  setQueryImpl(original)
})

afterAll(() => {
  setQueryImpl(original)
  delete process.env.VERCEL_ENV
  process.env.METRICS_DISABLED = '1'
})

describe('a thrown error in production', () => {
  it('adds one prod/error event with the route template, status, class and code, and counts the 5xx once', async () => {
    failDraftLookup()
    const res = await route(lookup())
    await flushMetrics()
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain(SECRET)

    const [event] = await events()
    expect(event).toMatchObject({ kind: 'error', name: 'GET /drafts/:id', status: '500' })
    expect(event.attrs).toMatchObject({ error: 'DraftStoreError', code: '23505' })

    const [row] = await metricRows()
    expect(Number(row.n_5xx)).toBe(1)
  })

  it('stores no message, no real path, no id and no user id', async () => {
    failDraftLookup()
    await route(lookup())
    await flushMetrics()
    const text = JSON.stringify(await events())
    expect(text).not.toContain('secret-message')
    expect(text).not.toContain('/home/user/private')
    expect(text).not.toContain('tok_abc123')
    expect(text).not.toContain(DRAFT_ID)
    expect(text).not.toContain(String(userId))
    expect(text).not.toContain('xt_')
  })

  it('a plain error with an odd class name or code keeps only the default class and no code', async () => {
    failDraftLookup(Object.assign(new Error(SECRET), { name: `tok_${'x'.repeat(10)} secret`, code: 'a secret value' }))
    await route(lookup())
    await flushMetrics()
    const [event] = await events()
    expect(event.attrs.error).toBe('Error')
    expect(event.attrs.code).toBeUndefined()
    expect(JSON.stringify(event)).not.toContain('secret')
  })

  it('a write that fails leaves the answer as it was and logs no error text', async () => {
    failDraftLookup()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setQueryImpl(async (text, params = []) => {
      if (text.includes('insert into ops_events')) throw new Error(`injected ${SECRET}`)
      if (text.includes('drafts where id')) throw Object.assign(new Error(SECRET), { name: 'DraftStoreError' })
      return original(text, params)
    })
    try {
      const res = await route(lookup())
      await flushMetrics()
      expect(res.status).toBe(500)
      expect(await res.text()).not.toContain(SECRET)
      expect(warn).toHaveBeenCalledWith('[metrics] error event write failed')
      expect(JSON.stringify(warn.mock.calls)).not.toContain('secret')
      expect(await events()).toEqual([])
      expect(Number((await metricRows())[0].n_5xx)).toBe(1)
    } finally {
      warn.mockRestore()
    }
  })
})

describe('when no event is written', () => {
  it('outside production the 5xx is still counted and no event is stored', async () => {
    process.env.VERCEL_ENV = 'preview'
    failDraftLookup()
    await route(lookup())
    await flushMetrics()
    expect(await events()).toEqual([])
    expect(Number((await metricRows())[0].n_5xx)).toBe(1)
  })

  it('a 4xx answer stores no event', async () => {
    await route(apiRequest('/api/drafts/44444444-4444-4444-8444-444444444444', { cookie }))
    await flushMetrics()
    expect(await events()).toEqual([])
  })

  it('at most 20 events per instance per hour, while every 5xx is still counted', async () => {
    failDraftLookup()
    for (let i = 0; i < 21; i += 1) await route(lookup())
    await flushMetrics()
    expect(await events()).toHaveLength(20)
    expect(Number((await metricRows())[0].n_5xx)).toBe(21)
  })

  it('at most 200 events a UTC day across instances: the insert counts the rows already stored', async () => {
    await db.pg.exec(
      `insert into ops_events (repo_id, source, kind, id, at, name, status)
       select 1136002672, 'prod', 'error', 'seed-' || g, now(), 'GET /x', '500' from generate_series(1, 199) g`
    )
    failDraftLookup()
    for (let i = 0; i < 3; i += 1) await route(lookup())
    await flushMetrics()
    const { rows } = await db.pg.query("select count(*)::int as n from ops_events where source = 'prod' and kind = 'error'")
    expect(rows[0].n).toBe(200)
  })
})
