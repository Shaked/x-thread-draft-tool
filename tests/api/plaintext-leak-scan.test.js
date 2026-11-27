// @vitest-environment node
// Plan H10 (issue #384, epic #273): draft text never reaches the logs, the error answers, the answers a
// second user gets, the admin answers (REST, MCP and "view as") or any table other than the draft tables.
// Each draft carries a unique marker in English and in Hebrew, at the start of every field. Every 6-character
// piece of each marker is searched for. All data here is fake. The test seeds once, then checks.
import { randomBytes } from 'node:crypto'
import { format } from 'node:util'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({
  putBlob: vi.fn(),
  deleteBlobUrls: vi.fn(async () => {}),
  listBlobPrefix: vi.fn(async () => ({ files: [], truncated: false }))
}))

import { ROUTES, route } from '../../server/router.js'
import { setQueryImpl } from '../../server/db.js'
import { flushMetrics } from '../../server/metrics/record.js'
import { runAs } from '../../server/caller-context.js'
import { issuePair, resolveAccess } from '../../server/oauth/tokens.js'
import { ADMIN_REST_ROUTES, ADMIN_TOOLS } from '../../server/mcp/admin-tools.js'
import { APP_URL, apiRequest, setupTestDb } from './helpers/db.js'

// Tables where draft text may live. Each entry says why it is allowed; every other table must hold no piece.
const DRAFT_TABLES = new Set([
  'drafts', // the draft rows; plain text today. After encryption, locked drafts hold ciphertext here.
  'draft_revisions', // revision titles (#375): draft text, copied by the trigger from drafts.title
  'draft_post_versions' // post bodies per revision (#375): draft text, copied by the trigger from drafts.posts
])

// Error answers that may hold draft text, each with its reason. The stale-save answer (412, #359) returns
// the current draft to the owner whose request was stale, so the client can merge. It is checked for that one
// caller only (see the 412 tests). Every other error answer is checked.
const OWNER_ONLY_ANSWERS = ['error: stale If-Match (alice REST, owner 412)']

const MCP = `${APP_URL}/api/mcp`
const MODERN = '2026-07-28'
const NIL = '00000000-0000-0000-0000-000000000000'
const ADMIN_GITHUB_ID = 960015
const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000)
const ADMIN_WEB = { 'x-xt-admin': '1' }

const randomHex = () => randomBytes(4).toString('hex')
const EN = `LEAKMARK-${randomHex()}`
const HE = `סימון-${randomHex()}`
const PIECES = [EN, HE].flatMap((marker) => Array.from({ length: marker.length - 5 }, (_, i) => marker.slice(i, i + 6)))

/** The (where, text) pairs that hold a piece of a marker, one line per hit. */
function leaksIn(entries) {
  return entries.flatMap(([where, text]) => PIECES.filter((piece) => text.includes(piece)).map((piece) => `${where}: "${piece}"`))
}

/** Every byte field as text, so a marker stored as bytes is found too. */
const asText = (_key, value) => (value instanceof Uint8Array ? Buffer.from(value).toString('utf8') : value)

let db
let failNextDraftInsert = false
// Request metrics and error events are off in the API suite; this file turns both on and restores them.
const savedEnv = { METRICS_DISABLED: process.env.METRICS_DISABLED, VERCEL_ENV: process.env.VERCEL_ENV }
const captured = []
const seen = [] // [where, text] for every answer the test receives; text starts with the status code
const spies = ['log', 'warn', 'error'].map((level) =>
  vi.spyOn(console, level).mockImplementation((...args) => {
    captured.push(format(...args))
  })
)

async function answerOf(res) {
  const headers = [...res.headers].map(([key, value]) => `${key}: ${value}`).join('\n')
  return `${res.status}\n${headers}\n${await res.text()}`
}

const statusOf = (text) => Number(text.slice(0, 3))

/** Sends one REST request and keeps its answer under `where`. Returns the Response. */
async function rest(where, { method = 'GET', path, body, cookie, headers } = {}) {
  const res = await route(apiRequest(`/api${path}`, { method, body, cookie, headers }))
  seen.push([where, await answerOf(res.clone())])
  return res
}

async function mcpCall(where, bearer, method, params = {}) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${bearer}`,
    'mcp-protocol-version': MODERN,
    'mcp-method': method
  }
  if (method === 'tools/call') headers['mcp-name'] = params.name
  const body = { jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN } } }
  const res = await route(new Request(MCP, { method: 'POST', headers, body: JSON.stringify(body) }))
  seen.push([where, await answerOf(res.clone())])
  return res
}

/** A grant for the MCP server, with its own client row. Returns the bearer token. */
async function mcpTokenFor(user, clientId, { adminUntil = null } = {}) {
  await db.pg.query(
    "insert into oauth_clients (client_id, kind, client_name, redirect_uris) values ($1, 'registered', 'Leak scan test', '{}')",
    [clientId]
  )
  const { rows } = await db.pg.query(
    'insert into oauth_grants (user_id, client_id, scope, resource, admin_until) values ($1, $2, $3, $4, $5) returning id',
    [user.id, clientId, 'drafts', MCP, adminUntil]
  )
  return (await issuePair(rows[0].id)).access_token
}

/** The caller of an elevated admin grant, for the admin tool REST routes (the guard needs adminTool set). */
async function elevatedAdmin(admin) {
  const token = await mcpTokenFor(admin, 'xtc_leak_scan_admin', { adminUntil: FUTURE })
  return { token, caller: await resolveAccess(token, MCP) }
}

const adminToolRest = (caller, toolName, method, path, body) =>
  runAs({ ...caller, adminTool: toolName }, () => rest(`admin REST ${method} ${path}`, { method, path: `${path}`, body, headers: ADMIN_WEB, cookie: undefined }))

let admin
let alice
let bob
let aliceCookie
let bobCookie
let adminCookie
let aliceMcp
let bobMcp
let adminMcp
let adminCaller
let draftEn
let draftHe
let staleStatus
let staleBody
const hits = new Set() // "METHOD /path" of every route the test called, as the router names them

// Query strings some admin reads need: the metrics series names a metric.
const QUERY_FOR = { 'GET /admin/metrics/series': '?name=requests' }

const isAdminRoute = (entry) => entry.path === '/admin' || entry.path.startsWith('/admin/')
const adminKeys = ROUTES.filter(isAdminRoute).map((entry) => `${entry.method} ${entry.path}`)

beforeAll(async () => {
  db = await setupTestDb()
  process.env.METRICS_DISABLED = '0'
  process.env.VERCEL_ENV = 'production'
  // A failure injected into one MCP tool: the next insert into drafts throws. Same SQL path as setupTestDb.
  setQueryImpl(async (text, params = []) => {
    if (failNextDraftInsert && /insert into drafts/i.test(text)) {
      failNextDraftInsert = false
      // A database error can carry values in its message and detail; the markers go there too.
      // A second line that starts with "at" is the case a frame filter must not pass (the logger keeps no message lines).
      const failure = new Error(`${EN} ${HE} injected failure\n    at ${EN} ${HE} injected frame`)
      failure.detail = `${EN} ${HE} failing row`
      throw failure
    }
    const result = await db.pg.query(text, params)
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length }
  })

  admin = await db.insertUser({ github_id: ADMIN_GITHUB_ID, login: 'shaked', name: 'Owner' })
  alice = await db.insertUser({ github_id: 1, login: 'alice', name: 'Alice Example' })
  bob = await db.insertUser({ github_id: 2, login: 'bob', name: 'Bob Example' })
  aliceCookie = await db.cookieFor(alice)
  bobCookie = await db.cookieFor(bob)
  adminCookie = await db.cookieFor(admin)
  aliceMcp = await mcpTokenFor(alice, 'xtc_leak_scan_alice')
  bobMcp = await mcpTokenFor(bob, 'xtc_leak_scan_bob')
  adminMcp = await mcpTokenFor(admin, 'xtc_leak_scan_admin_mcp', { adminUntil: FUTURE })
  adminCaller = (await elevatedAdmin(admin)).caller

  // Alice: two drafts over REST. Each field starts with a marker; the embedded tweet URL carries the English one.
  const post = (id, text, embeddedTweet = null) => ({ id, text, images: [], embeddedTweet })
  const created = await rest('alice REST create', {
    method: 'POST',
    path: '/drafts',
    cookie: aliceCookie,
    body: { title: `${EN} English title`, posts: [post('p1', `${EN} English post`, `https://x.com/fake_user/status/${EN}`)] }
  })
  draftEn = (await created.json()).draft
  const createdHe = await rest('alice REST create (Hebrew)', {
    method: 'POST',
    path: '/drafts',
    cookie: aliceCookie,
    body: { title: `${HE} כותרת`, posts: [post('h1', `${HE} פוסט`)] }
  })
  draftHe = (await createdHe.json()).draft

  // Alice's MCP tools: create, thread from text, add, update.
  await mcpCall('alice MCP create_draft', aliceMcp, 'tools/call', { name: 'create_draft', arguments: { title: `${EN} MCP`, posts: [{ text: `${EN} MCP post` }] } })
  await mcpCall('alice MCP create_thread_from_text', aliceMcp, 'tools/call', { name: 'create_thread_from_text', arguments: { text: `${HE} שרשור ואז עוד` } })
  await mcpCall('alice MCP add_post', aliceMcp, 'tools/call', { name: 'add_post', arguments: { id: draftEn.id, text: `${EN} added` } })
  await mcpCall('alice MCP update_post', aliceMcp, 'tools/call', { name: 'update_post', arguments: { id: draftHe.id, post_id: 'h1', text: `${HE} changed` } })
  await rest('alice REST share', { method: 'POST', path: `/drafts/${draftEn.id}/share-tokens`, cookie: aliceCookie, body: {} })
  await rest('alice REST export', { path: `/drafts/${draftEn.id}/export?format=text`, cookie: aliceCookie })

  // Errors that happen: bad JSON, a stale If-Match, an injected MCP failure. Every answer is checked below,
  // except the owner's own stale-save answer, which is checked on its own.
  seen.push([
    'error: bad JSON (alice REST)',
    await answerOf(await route(apiRequest('/api/drafts', { method: 'POST', cookie: aliceCookie, headers: { 'content-type': 'application/json' }, body: `{"title":"${EN}" ` })))
  ])
  const stale = await route(apiRequest(`/api/drafts/${draftEn.id}`, { method: 'PATCH', cookie: aliceCookie, headers: { 'if-match': '"99999"' }, body: { title: `${EN} stale` } }))
  staleStatus = stale.status
  staleBody = await stale.clone().json()
  seen.push([OWNER_ONLY_ANSWERS[0], await answerOf(stale)])
  failNextDraftInsert = true
  await mcpCall('error: injected MCP failure (alice create_draft)', aliceMcp, 'tools/call', {
    name: 'create_draft',
    arguments: { title: `${EN} boom`, posts: [{ text: `${HE} boom` }] }
  })
  expect(failNextDraftInsert, 'the injected failure was used').toBe(false)

  // User B: every answer B gets about alice's drafts, over REST and MCP. Including a stale PATCH: B gets a 404, never a 412.
  await rest('bob REST get', { path: `/drafts/${draftEn.id}`, cookie: bobCookie })
  await rest('bob REST export', { path: `/drafts/${draftEn.id}/export?format=text`, cookie: bobCookie })
  await rest('bob REST patch', { method: 'PATCH', path: `/drafts/${draftHe.id}`, cookie: bobCookie, body: { title: `${HE} bob` } })
  await rest('bob REST stale patch', { method: 'PATCH', path: `/drafts/${draftEn.id}`, cookie: bobCookie, headers: { 'if-match': '"99999"' }, body: { title: `${EN} bob` } })
  await rest('bob REST share', { method: 'POST', path: `/drafts/${draftEn.id}/share-tokens`, cookie: bobCookie, body: {} })
  await mcpCall('bob MCP get_draft', bobMcp, 'tools/call', { name: 'get_draft', arguments: { id: draftEn.id } })
  await mcpCall('bob MCP update_post', bobMcp, 'tools/call', { name: 'update_post', arguments: { id: draftHe.id, post_id: 'h1', text: `${EN} bob` } })
  await mcpCall('bob MCP export_draft', bobMcp, 'tools/call', { name: 'export_draft', arguments: { id: draftEn.id } })

  // Admin "view as": start (website only), the list under view-as (both halves of the published filter), one draft
  // (refused by design), and a stale PATCH under view-as. Only the owner's own request gets a 412.
  const viewAs = await rest('admin REST view-as start', {
    method: 'POST',
    path: '/admin/view-as',
    cookie: adminCookie,
    headers: ADMIN_WEB,
    body: { user_id: alice.id, reason: 'leak scan fake reason' }
  })
  hits.add('POST /admin/view-as')
  expect(viewAs.status, 'view-as starts for the fake user').toBe(200)
  const viewAsCookie = `${adminCookie}; ${viewAs.headers.getSetCookie().map((line) => line.split(';')[0]).join('; ')}`
  for (const published of ['false', 'true']) {
    await rest(`admin REST GET /drafts (view as, published=${published})`, { path: `/drafts?published=${published}`, cookie: viewAsCookie, headers: ADMIN_WEB })
  }
  await rest('admin view-as: one draft', { path: `/drafts/${draftEn.id}`, cookie: viewAsCookie, headers: ADMIN_WEB })
  await rest('admin view-as: stale patch', { method: 'PATCH', path: `/drafts/${draftEn.id}`, cookie: viewAsCookie, headers: { ...ADMIN_WEB, 'if-match': '"99999"' }, body: { title: `${EN} viewed` } })

  // The revision routes (#378): alice reads her own history (owner answers, not scanned for the marker). Every other caller
  // gets no text: bob 404, the admin's own cookie 404, view-as 403, an MCP bearer on REST 401. The error answers (404 and a
  // 400 that carries the marker in `against`) are scanned with the other errors.
  for (const draft of [draftEn, draftHe]) {
    await rest('alice REST revisions list', { path: `/drafts/${draft.id}/revisions`, cookie: aliceCookie })
    await rest('alice REST revision read', { path: `/drafts/${draft.id}/revisions/1`, cookie: aliceCookie })
    await rest('alice REST revision read against current', { path: `/drafts/${draft.id}/revisions/1?against=current`, cookie: aliceCookie })
    await rest('bob REST revisions list', { path: `/drafts/${draft.id}/revisions`, cookie: bobCookie })
    await rest('bob REST revision read', { path: `/drafts/${draft.id}/revisions/1`, cookie: bobCookie })
    await rest('bob REST revision read against current', { path: `/drafts/${draft.id}/revisions/1?against=current`, cookie: bobCookie })
    await rest('admin own cookie: revisions list', { path: `/drafts/${draft.id}/revisions`, cookie: adminCookie, headers: ADMIN_WEB })
    await rest('admin own cookie: revision read', { path: `/drafts/${draft.id}/revisions/1`, cookie: adminCookie, headers: ADMIN_WEB })
    await rest('admin view-as: revisions list', { path: `/drafts/${draft.id}/revisions`, cookie: viewAsCookie, headers: ADMIN_WEB })
    await rest('admin view-as: revision read', { path: `/drafts/${draft.id}/revisions/1?against=current`, cookie: viewAsCookie, headers: ADMIN_WEB })
    await rest('admin bearer token: revisions list', { path: `/drafts/${draft.id}/revisions`, headers: { authorization: `Bearer ${adminMcp}` } })
    await rest('admin bearer token: revision read', { path: `/drafts/${draft.id}/revisions/1`, headers: { authorization: `Bearer ${adminMcp}` } })
  }
  await rest('error: revision not found (alice REST)', { path: `/drafts/${draftEn.id}/revisions/99999`, cookie: aliceCookie })
  await rest('error: revision bad against (alice REST, marker in the query)', { path: `/drafts/${draftEn.id}/revisions/1?against=${encodeURIComponent(EN)}`, cookie: aliceCookie })
  await rest('error: revision bad limit (alice REST, marker in the query)', { path: `/drafts/${draftEn.id}/revisions?limit=${encodeURIComponent(HE)}`, cookie: aliceCookie })

  // Every admin REST route the router has, called once through the website surface as the admin. GET of one user
  // uses alice's id; a route that changes a user or a flag gets the nil id (no user, no change); metrics series names a metric (requests).
  const bodyFor = { 'POST /admin/flags': {}, 'POST /admin/users/:id/suspend': {}, 'POST /admin/users/:id/unsuspend': {}, 'POST /admin/users/:id/delete': {} }
  for (const entry of ROUTES.filter(isAdminRoute)) {
    const key = `${entry.method} ${entry.path}`
    if (hits.has(key)) continue // the view-as start, above
    const id = entry.method === 'GET' ? alice.id : NIL
    const path = entry.path.replace(':id', id) + (QUERY_FOR[key] ?? '')
    const res = await rest(`admin REST ${entry.method} ${path}`, { method: entry.method, path, cookie: adminCookie, headers: ADMIN_WEB, body: bodyFor[key] })
    // The router's own "Not found" means the call never reached a handler: that is not coverage.
    if (res.status === 404 && seen.at(-1)[1].includes('"Not found"')) throw new Error(`${key} fell through to the router's 404`)
    hits.add(key)
  }

  // The same admin reads through the tool guard (adminTool set), for every admin tool REST mapping.
  for (const [toolName, keys] of Object.entries(ADMIN_REST_ROUTES)) {
    for (const key of keys) {
      const method = key.split(' ')[0]
      const pattern = key.slice(key.indexOf(' ') + 1)
      const path = pattern.replace(NIL, method === 'GET' ? alice.id : NIL) + (QUERY_FOR[key] ?? '')
      await adminToolRest(adminCaller, toolName, method, path, method === 'GET' ? undefined : {})
    }
  }

  // Every admin MCP tool, as the admin. The three that change a user get the nil id; metrics series names a metric (requests).
  for (const tool of ADMIN_TOOLS) {
    const args =
      tool.name === 'admin_get_user'
        ? { id: alice.id }
        : ['admin_suspend_user', 'admin_unsuspend_user', 'admin_delete_user'].includes(tool.name)
          ? { id: NIL }
          : tool.name === 'admin_metrics_series'
            ? { name: 'requests' }
            : {}
    await mcpCall(`admin MCP ${tool.name}`, adminMcp, 'tools/call', { name: tool.name, arguments: args })
  }

  // Metrics are written in the background: wait for them, so the table scan and the admin answers see them.
  await flushMetrics()
}, 20000)

afterAll(() => {
  for (const spy of spies) spy.mockRestore()
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('plaintext leak scan (issue #384)', () => {
  it('no captured console.log, warn or error line holds a piece of a marker', () => {
    expect(captured.length).toBeGreaterThan(0)
    expect(leaksIn(captured.map((line, index) => [`console line ${index}`, line]))).toEqual([])
  })

  it('no answer user B gets holds a piece of a marker', () => {
    const bobAnswers = seen.filter(([where]) => where.startsWith('bob '))
    expect(bobAnswers.length).toBeGreaterThan(0)
    expect(leaksIn(bobAnswers)).toEqual([])
  })

  it('user B gets 404 on every REST draft call, and an error result on every MCP call (not an empty success)', () => {
    const rests = seen.filter(([where]) => where.startsWith('bob REST '))
    expect(rests.length).toBeGreaterThan(0)
    expect(rests.map(([where, text]) => [where, statusOf(text)])).toEqual(rests.map(([where]) => [where, 404]))
    const mcps = seen.filter(([where]) => where.startsWith('bob MCP '))
    expect(mcps.length).toBeGreaterThan(0)
    for (const [where, text] of mcps) expect(text, where).toContain('"isError":true')
  })

  it('no error answer holds a piece of a marker, except the owner-only stale-save answer', () => {
    const errors = seen.filter(([where]) => where.startsWith('error:') && !OWNER_ONLY_ANSWERS.includes(where))
    expect(errors).toHaveLength(5)
    expect(leaksIn(errors)).toEqual([])
  })

  it('the stale-save answer is a 412 with the owner\'s draft, and no other caller gets a 412 with a draft', () => {
    expect(staleStatus).toBe(412)
    expect(staleBody.draft.id).toBe(draftEn.id)
    const others = seen.filter(([where]) => where === 'bob REST stale patch' || where === 'admin view-as: stale patch')
    expect(others).toHaveLength(2)
    for (const [where, text] of others) expect(statusOf(text), where).not.toBe(412)
    expect(leaksIn(others)).toEqual([])
  })

  it('the revision routes answer the owner with 200 and everyone else with no text (#378)', () => {
    const own = seen.filter(([where]) => where.startsWith('alice REST revision'))
    expect(own).toHaveLength(6)
    expect(own.map(([where, text]) => [where, statusOf(text)]).filter(([, status]) => status !== 200)).toEqual([])
    const status = (prefix) => seen.filter(([where]) => where.startsWith(prefix)).map(([, text]) => statusOf(text))
    expect(status('admin own cookie: revision')).toEqual([404, 404, 404, 404])
    expect(status('admin view-as: revision')).toEqual([403, 403, 403, 403])
    expect(status('admin bearer token: revision')).toEqual([401, 401, 401, 401])
    expect(status('error: revision')).toEqual([404, 400, 400])
  })

  it('no admin answer holds a piece of a marker: REST, MCP and "view as"', () => {
    const adminAnswers = seen.filter(([where]) => where.startsWith('admin'))
    expect(adminAnswers.length).toBeGreaterThan(0)
    expect(leaksIn(adminAnswers)).toEqual([])
  })

  it('admin reads answer 200, so the scan reads real answers (view-as list included)', () => {
    const reads = seen.filter(([where]) => where.startsWith('admin REST GET '))
    expect(reads.length).toBeGreaterThan(0)
    expect(reads.map(([where, text]) => [where, statusOf(text)]).filter(([, status]) => status !== 200)).toEqual([])
  })

  it('the calls cover every admin route the router has, and every admin tool', () => {
    expect(adminKeys.length).toBeGreaterThan(0)
    expect([...hits].sort()).toEqual(expect.arrayContaining([...adminKeys].sort()))
    const called = new Set(seen.filter(([where]) => where.startsWith('admin MCP ')).map(([where]) => where.slice('admin MCP '.length)))
    expect([...called].sort()).toEqual(ADMIN_TOOLS.map((tool) => tool.name).sort())
  })

  it('each admin POST reached its handler: a validation or not-found answer from the handler, not the router', () => {
    const answer = (where) => seen.find(([w]) => w.startsWith('admin REST POST ') && w.endsWith(where))?.[1] ?? ''
    expect(answer('/suspend')).toContain('confirm_login')
    expect(answer('/delete')).toContain('User not found')
    expect(answer('/admin/flags')).toContain('name must be one of')
    expect(answer('/admin/flags')).not.toContain('"Not found"')
  })

  it('the draft tables hold both markers (a control: the scan would see them if they were elsewhere)', async () => {
    const { rows } = await db.pg.query('select * from drafts')
    const text = JSON.stringify(rows, asText)
    expect(text).toContain(EN)
    expect(text).toContain(HE)
  })

  it('the revision tables hold the markers too, so they belong in the draft-table allow-list (#375)', async () => {
    const { rows } = await db.pg.query('select title, post_order from draft_revisions')
    const { rows: bodies } = await db.pg.query('select body from draft_post_versions')
    const text = JSON.stringify([rows, bodies], asText)
    expect(text).toContain(EN)
    expect(text).toContain(HE)
  })

  it('no table other than the draft tables holds a piece of a marker', async () => {
    const { rows: tables } = await db.pg.query(
      "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name"
    )
    const names = tables.map((row) => row.table_name)
    expect(names.length).toBeGreaterThan(1)
    const leaks = []
    for (const name of names.filter((table) => !DRAFT_TABLES.has(table))) {
      const { rows } = await db.pg.query(`select * from "${name}"`)
      leaks.push(...leaksIn([[`table ${name}`, JSON.stringify(rows, asText)]]))
    }
    expect(leaks).toEqual([])
  })

  it('the scan fails when a marker is logged (a fake console.error, then removed from the captured lines)', () => {
    console.error(`fake log line ${EN}`)
    const line = captured.at(-1)
    expect(leaksIn([['console line (fake)', line]])).not.toEqual([])
    captured.splice(captured.indexOf(line), 1)
    expect(leaksIn(captured.map((text, index) => [`console line ${index}`, text]))).toEqual([])
  })
})
