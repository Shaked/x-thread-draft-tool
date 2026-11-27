// @vitest-environment node
// Plan H10 (issue #384, epic #273): draft text never reaches the logs, the error answers, the answers a
// second user gets, the admin answers (REST, MCP and "view as") or any table other than the draft tables.
// Each draft carries a unique marker in English and in Hebrew, and every 6-character piece of each marker
// is searched for. All data here is fake. The test seeds once, then checks.
import { randomBytes } from 'node:crypto'
import { format } from 'node:util'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({
  putBlob: vi.fn(),
  deleteBlobUrls: vi.fn(async () => {}),
  listBlobPrefix: vi.fn(async () => ({ files: [], truncated: false }))
}))

import { route } from '../../server/router.js'
import { setQueryImpl } from '../../server/db.js'
import { runAs } from '../../server/caller-context.js'
import { issuePair, resolveAccess } from '../../server/oauth/tokens.js'
import { ADMIN_REST_ROUTES, ADMIN_TOOL_REST_ROUTES, ADMIN_TOOLS } from '../../server/mcp/admin-tools.js'
import { APP_URL, apiRequest, setupTestDb } from './helpers/db.js'

// Tables where draft text may live. Each entry says why it is allowed; every other table must hold no piece.
const DRAFT_TABLES = new Set([
  'drafts' // the draft rows; plain text today. After encryption, locked drafts hold ciphertext here.
])

// Error answers that may hold draft text, each with its reason. The stale-save answer (412, #359) returns
// the current draft to its owner so the client can merge; no other user gets it. Every other error answer is checked.
const OWNER_ONLY_ANSWERS = ['error: stale If-Match (alice REST, owner 412)']

const MCP = `${APP_URL}/api/mcp`
const MODERN = '2026-07-28'
const NIL = '00000000-0000-0000-0000-000000000000'
const ADMIN_GITHUB_ID = 960015
const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000)

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
const captured = []
const seen = [] // [where, text] for every answer the test receives
const spies = ['log', 'warn', 'error'].map((level) =>
  vi.spyOn(console, level).mockImplementation((...args) => {
    captured.push(format(...args))
  })
)

async function answerOf(res) {
  const headers = [...res.headers].map(([key, value]) => `${key}: ${value}`).join('\n')
  return `${res.status}\n${headers}\n${await res.text()}`
}

/** Sends one REST request and keeps its answer under `where`. Returns the Response (body already read into the record). */
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

/** The caller of an elevated admin grant, for the admin REST routes (the guard needs adminTool set). */
async function elevatedAdmin(admin) {
  const token = await mcpTokenFor(admin, 'xtc_leak_scan_admin', { adminUntil: FUTURE })
  return { token, caller: await resolveAccess(token, MCP) }
}

const adminRest = (caller, toolName, method, path, body) =>
  runAs({ ...caller, adminTool: toolName }, async () => {
    const res = await route(apiRequest(`/api${path}`, { method, body }))
    seen.push([`admin REST ${method} ${path}`, await answerOf(res.clone())])
    return res
  })

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
const hits = new Set() // admin REST route patterns that were called

beforeAll(async () => {
  db = await setupTestDb()
  // A failure injected into one MCP tool: the next insert into drafts throws. Same SQL path as setupTestDb.
  setQueryImpl(async (text, params = []) => {
    if (failNextDraftInsert && /insert into drafts/i.test(text)) {
      failNextDraftInsert = false
      throw new Error('injected failure')
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

  // Alice: two drafts over REST, one with the English marker (also in the embedded tweet URL), one with the Hebrew.
  const post = (id, text, embeddedTweet = null) => ({ id, text, images: [], embeddedTweet })
  const created = await rest('alice REST create', {
    method: 'POST',
    path: '/drafts',
    cookie: aliceCookie,
    body: { title: `English title ${EN}`, posts: [post('p1', `English post ${EN}`, `https://x.com/fake_user/status/${EN}`)] }
  })
  draftEn = (await created.json()).draft
  const createdHe = await rest('alice REST create (Hebrew)', {
    method: 'POST',
    path: '/drafts',
    cookie: aliceCookie,
    body: { title: `כותרת ${HE}`, posts: [post('h1', `פוסט ${HE}`)] }
  })
  draftHe = (await createdHe.json()).draft

  // Alice's MCP tools: create, add, update, a thread from text, and a share link and an export.
  await mcpCall('alice MCP create_draft', aliceMcp, 'tools/call', { name: 'create_draft', arguments: { title: `MCP ${EN}`, posts: [{ text: `MCP post ${EN}` }] } })
  await mcpCall('alice MCP create_thread_from_text', aliceMcp, 'tools/call', { name: 'create_thread_from_text', arguments: { text: `שרשור ${HE} ואז עוד` } })
  await mcpCall('alice MCP add_post', aliceMcp, 'tools/call', { name: 'add_post', arguments: { id: draftEn.id, text: `added ${EN}` } })
  await mcpCall('alice MCP update_post', aliceMcp, 'tools/call', { name: 'update_post', arguments: { id: draftHe.id, post_id: 'h1', text: `changed ${HE}` } })
  await rest('alice REST share', { method: 'POST', path: `/drafts/${draftEn.id}/share-tokens`, cookie: aliceCookie, body: {} })
  await rest('alice REST export', { path: `/drafts/${draftEn.id}/export?format=text`, cookie: aliceCookie })

  // Errors that happen: bad JSON, a stale If-Match, an injected MCP failure, and a 404 by user B.
  // Every answer to these is checked below, whoever gets it.
  seen.push([
    'error: bad JSON (alice REST)',
    await answerOf(await route(apiRequest('/api/drafts', { method: 'POST', cookie: aliceCookie, headers: { 'content-type': 'application/json' }, body: `{"title":"${EN}" ` })))
  ])
  seen.push([
    OWNER_ONLY_ANSWERS[0],
    await answerOf(
      await route(apiRequest(`/api/drafts/${draftEn.id}`, { method: 'PATCH', cookie: aliceCookie, headers: { 'if-match': '"99999"' }, body: { title: `stale ${EN}` } }))
    )
  ])
  failNextDraftInsert = true
  await mcpCall('error: injected MCP failure (alice create_draft)', aliceMcp, 'tools/call', {
    name: 'create_draft',
    arguments: { title: `boom ${EN}`, posts: [{ text: `boom ${HE}` }] }
  })
  expect(failNextDraftInsert, 'the injected failure was used').toBe(false)

  // User B: every answer B gets about alice's drafts (404 or refusal), over REST and MCP.
  await rest('bob REST get', { path: `/drafts/${draftEn.id}`, cookie: bobCookie })
  await rest('bob REST export', { path: `/drafts/${draftEn.id}/export?format=text`, cookie: bobCookie })
  await rest('bob REST patch', { method: 'PATCH', path: `/drafts/${draftHe.id}`, cookie: bobCookie, body: { title: `bob ${HE}` } })
  await rest('bob REST share', { method: 'POST', path: `/drafts/${draftEn.id}/share-tokens`, cookie: bobCookie, body: {} })
  await mcpCall('bob MCP get_draft', bobMcp, 'tools/call', { name: 'get_draft', arguments: { id: draftEn.id } })
  await mcpCall('bob MCP update_post', bobMcp, 'tools/call', { name: 'update_post', arguments: { id: draftHe.id, post_id: 'h1', text: `bob ${EN}` } })
  await mcpCall('bob MCP export_draft', bobMcp, 'tools/call', { name: 'export_draft', arguments: { id: draftEn.id } })

  // Admin: the "view as" start (website only) and the admin REST routes and admin MCP tools, as the admin.
  // The website admin surface needs the x-xt-admin header (as in admin-web.test.js).
  const adminWeb = { 'x-xt-admin': '1' }
  const viewAs = await rest('admin REST view-as start', {
    method: 'POST',
    path: '/admin/view-as',
    cookie: adminCookie,
    headers: adminWeb,
    body: { user_id: alice.id, reason: 'leak scan fake reason' }
  })
  expect(viewAs.status, 'view-as starts for the fake user').toBe(200)
  const viewAsCookie = viewAs.headers.getSetCookie().map((line) => line.split(';')[0]).join('; ')
  // The list under view-as (both halves of the published filter); one draft is refused by design (403).
  for (const published of ['false', 'true']) {
    await rest(`admin view-as: drafts (published=${published})`, { path: `/drafts?published=${published}`, cookie: `${adminCookie}; ${viewAsCookie}`, headers: adminWeb })
  }
  await rest('admin view-as: one draft', { path: `/drafts/${draftEn.id}`, cookie: `${adminCookie}; ${viewAsCookie}`, headers: adminWeb })

  // Every admin REST route: GET with alice's id, POST with the nil id (no user, no change) and an empty body.
  for (const [toolName, keys] of Object.entries(ADMIN_REST_ROUTES)) {
    for (const key of keys) {
      const [method, pattern] = [key.split(' ')[0], key.slice(key.indexOf(' ') + 1)]
      hits.add(`${method} ${pattern.replace(NIL, ':id')}`)
      const path = pattern.replace(NIL, method === 'GET' ? alice.id : NIL)
      await adminRest(adminCaller, toolName, method, `${path}`, method === 'GET' ? undefined : {})
    }
  }

  // Every admin MCP tool, as the admin. The three that change a user or a flag get the nil id.
  for (const tool of ADMIN_TOOLS) {
    const args = tool.name === 'admin_get_user' ? { id: alice.id } : ['admin_suspend_user', 'admin_unsuspend_user', 'admin_delete_user'].includes(tool.name) ? { id: NIL } : {}
    await mcpCall(`admin MCP ${tool.name}`, adminMcp, 'tools/call', { name: tool.name, arguments: args })
  }
}, 20000)

afterAll(() => {
  for (const spy of spies) spy.mockRestore()
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

  it('no error answer holds a piece of a marker, except the owner-only stale-save answer', () => {
    const errors = seen.filter(([where]) => where.startsWith('error:') && !OWNER_ONLY_ANSWERS.includes(where))
    expect(errors).toHaveLength(2)
    expect(leaksIn(errors)).toEqual([])
  })

  it('no admin answer holds a piece of a marker: REST, MCP and "view as"', () => {
    const adminAnswers = seen.filter(([where]) => where.startsWith('admin'))
    expect(adminAnswers.length).toBeGreaterThan(0)
    expect(leaksIn(adminAnswers)).toEqual([])
  })

  it('the admin calls cover every admin REST route and every admin tool', () => {
    expect([...hits]).toEqual(expect.arrayContaining(ADMIN_TOOL_REST_ROUTES))
    const called = new Set(seen.filter(([where]) => where.startsWith('admin MCP ')).map(([where]) => where.slice('admin MCP '.length)))
    expect([...called].sort()).toEqual(ADMIN_TOOLS.map((tool) => tool.name).sort())
  })

  it('the draft tables hold the markers (a control: the scan would see them if they were elsewhere)', async () => {
    const { rows } = await db.pg.query('select * from drafts')
    expect(leaksIn([['drafts', JSON.stringify(rows, asText)]]).length).toBeGreaterThan(0)
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
