// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose'
import { ciAudience, OIDC_ISSUER, OPS_WORKFLOW_PATH, opsEventsAudience, setJwksForTests, verifyOpsToken } from '../../server/oidc-ci.js'
import { route } from '../../server/router.js'
import { ingestBatch } from '../../server/ops/ingest.js'
import { setupTestDb } from './helpers/db.js'

// Central metrics plan M2 (#439, task #448): POST /api/ops/events, its token and the ingest rules.
const REPO_ID = 1136002672
const OPS_REF = `Shaked/x-thread-draft-tool/${OPS_WORKFLOW_PATH}@refs/heads/main`
const ENV = { CI_OIDC_ENABLED: '1', VERCEL_ENV: 'preview', CI_OIDC_REPOSITORY_ID: String(REPO_ID) }
const URL_BASE = 'https://app.test/api/ops/events'

let db
let signingKey
let kid = 'ops-test-kid'

beforeAll(async () => {
  db = await setupTestDb()
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  signingKey = privateKey
  setJwksForTests(createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' }] }))
  Object.assign(process.env, ENV)
})

beforeEach(async () => {
  await db.pg.exec('delete from ops_events; delete from ops_daily; delete from ops_cursor;')
})

const query = (text, params) => db.pg.query(text, params)

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

async function mint(body = {}, { aud = opsEventsAudience('preview') } = {}) {
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

const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString()
const event = (id, extra = {}) => ({
  source: 'ci',
  kind: 'run',
  id,
  at: hoursAgo(1),
  name: 'Tests',
  status: 'success',
  ms: 97000,
  attrs: { event: 'pull_request' },
  link: `https://github.com/Shaked/x-thread-draft-tool/actions/runs/${id}`,
  ...extra
})
const batch = (events, extra = {}) => ({ v: 1, repo_id: REPO_ID, events, ...extra })

async function post(body, token) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  return route(new Request(URL_BASE, { method: 'POST', headers, body: JSON.stringify(body) }))
}

describe('verifyOpsToken', () => {
  it('accepts the metrics-daily token for this environment', async () => {
    expect(await verifyOpsToken(await mint(), { ...ENV })).not.toBeNull()
    expect(await verifyOpsToken(await mint({ event_name: 'workflow_dispatch' }), { ...ENV })).not.toBeNull()
  })

  it('refuses another audience: CI, and the production audience on preview', async () => {
    expect(await verifyOpsToken(await mint({}, { aud: ciAudience('preview') }), { ...ENV })).toBeNull()
    expect(await verifyOpsToken(await mint({}, { aud: opsEventsAudience('production') }), { ...ENV })).toBeNull()
  })

  it('refuses other workflows, branches, events and runners', async () => {
    const other = `Shaked/x-thread-draft-tool/.github/workflows/ui-image-upload.yml@refs/heads/main`
    const branch = 'refs/heads/claude/some-branch'
    const cases = [
      { workflow_ref: other, job_workflow_ref: other },
      { workflow_ref: `Shaked/x-thread-draft-tool/${OPS_WORKFLOW_PATH}@${branch}`, job_workflow_ref: `Shaked/x-thread-draft-tool/${OPS_WORKFLOW_PATH}@${branch}`, ref: branch },
      { event_name: 'pull_request' },
      { runner_environment: 'self-hosted' },
      { repository_id: '1' }
    ]
    for (const override of cases) {
      expect(await verifyOpsToken(await mint(override), { ...ENV })).toBeNull()
    }
  })

  it('is off unless CI_OIDC_ENABLED is 1', async () => {
    expect(await verifyOpsToken(await mint(), { ...ENV, CI_OIDC_ENABLED: '0' })).toBeNull()
  })
})

describe('POST /api/ops/events: who may post', () => {
  it('answers 404 to a request with no token: the /ops gate answers first', async () => {
    expect((await post(batch([]))).status).toBe(404)
  })

  it('answers 404 to a CI-audience token on this route: the gate answers first', async () => {
    expect((await post(batch([]), await mint({}, { aud: ciAudience('preview') }))).status).toBe(404)
  })

  it('refuses the ops token on a route that is not marked for it', async () => {
    const res = await route(new Request('https://app.test/api/drafts', { headers: { authorization: `Bearer ${await mint()}` } }))
    expect(res.status).toBe(401)
  })
})

describe('POST /api/ops/events: the batch', () => {
  it('stores each new event once and reports duplicates', async () => {
    const token = await mint()
    const first = await (await post(batch([event('1'), event('2')]), token)).json()
    expect(first).toEqual({ accepted: 2, duplicates: 0, refused: 0, cursor: null })
    const again = await (await post(batch([event('2'), event('3')]), token)).json()
    expect(again).toEqual({ accepted: 1, duplicates: 1, refused: 0, cursor: null })
    const { rows } = await query('select count(*)::int as n from ops_events')
    expect(rows[0].n).toBe(3)
  })

  it('refuses one bad event and stores the rest', async () => {
    const res = await post(batch([event('1'), event('2', { status: 'weird' })]), await mint())
    expect(await res.json()).toEqual({ accepted: 1, duplicates: 0, refused: 1, cursor: null })
  })

  it('stores the cursor sent, answers it, and an empty batch only returns it', async () => {
    const token = await mint()
    const cursor = hoursAgo(2)
    const sent = await (await post(batch([event('1')], { cursor }), token)).json()
    expect(sent.cursor).toBe(new Date(cursor).toISOString())
    const empty = await (await post(batch([]), token)).json()
    expect(empty).toEqual({ accepted: 0, duplicates: 0, refused: 0, cursor: new Date(cursor).toISOString() })
  })

  it('refuses a cursor outside the time window, and a batch over 500 events', async () => {
    const token = await mint()
    expect((await post(batch([], { cursor: '2001-01-01T00:00:00Z' }), token)).status).toBe(400)
    const many = Array.from({ length: 501 }, (_, i) => event(String(i)))
    expect((await post(batch(many), token)).status).toBe(413)
  })

  it('refuses a repo that is not listed, and a body that is not version 1', async () => {
    const token = await mint()
    expect((await post({ v: 1, repo_id: 1, events: [] }, token)).status).toBe(403)
    expect((await post({ v: 2, repo_id: REPO_ID, events: [] }, token)).status).toBe(400)
  })

  it('replaces a finished day counters, and refuses today', async () => {
    const token = await mint()
    const day = hoursAgo(72).slice(0, 10)
    const counter = (count, status = 'skipped') => ({ day, source: 'ci', kind: 'run', name: 'Tests', status, count })
    await post(batch([], { counters: [counter(4), counter(9, 'cancelled')] }), token)
    await post(batch([], { counters: [counter(7)] }), token)
    const { rows } = await query('select status, count from ops_daily order by status')
    expect(rows).toEqual([{ status: 'skipped', count: 7 }])
    const today = new Date().toISOString().slice(0, 10)
    const res = await post(batch([], { counters: [{ ...counter(1), day: today }] }), token)
    expect(res.status).toBe(400)
  })
})

describe('ingestBatch: caps and the row guard', () => {
  it('refuses the whole batch over the daily event cap, and stores nothing', async () => {
    await ingestBatch(batch([event('1'), event('2')]), { dailyEventCap: 2 })
    await expect(ingestBatch(batch([event('3')]), { dailyEventCap: 2 })).rejects.toMatchObject({ status: 429 })
    const { rows } = await query('select count(*)::int as n from ops_events')
    expect(rows[0].n).toBe(2)
  })

  it('refuses events once ops_events is over the row guard, and keeps the cursor', async () => {
    await ingestBatch(batch([event('1'), event('2')]))
    await expect(ingestBatch(batch([event('3')], { cursor: hoursAgo(1) }), { rowGuard: 1 })).rejects.toMatchObject({ status: 503 })
    const { rows } = await query('select count(*)::int as n from ops_cursor')
    expect(rows[0].n).toBe(0)
  })

  it('refuses more than 200 counter rows for one day', async () => {
    const day = hoursAgo(72).slice(0, 10)
    const counters = Array.from({ length: 201 }, (_, i) => ({ day, source: 'ci', kind: 'run', name: `wf${i}`, status: 'skipped', count: 1 }))
    await expect(ingestBatch(batch([], { counters }))).rejects.toMatchObject({ status: 429 })
  })

  it('refuses a counter day older than the 400-day retention', async () => {
    const old = new Date(Date.now() - 401 * 24 * 3600_000).toISOString().slice(0, 10)
    await expect(ingestBatch(batch([], { counters: [{ day: old, source: 'ci', kind: 'run', name: 'Tests', status: 'skipped', count: 1 }] }))).rejects.toMatchObject({ status: 400 })
  })

  it('counts a repeated event in one batch once toward the daily cap', async () => {
    await expect(ingestBatch(batch([event('9'), event('9')]), { dailyEventCap: 1 })).resolves.toMatchObject({ accepted: 1, duplicates: 1 })
  })
})
