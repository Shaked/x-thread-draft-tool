// @vitest-environment node
// Admin plan A7 (issue #195): the read tools and routes for users, one user, statistics and the audit log.
// Every number is seeded here, so each expected count is written down by hand. All data is fake.
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({
  putBlob: vi.fn(),
  deleteBlobUrls: vi.fn(async () => {}),
  listBlobPrefix: vi.fn(async () => ({ files: [], truncated: false }))
}))

import { route } from '../../server/router.js'
import { runAs } from '../../server/caller-context.js'
import { issuePair, resolveAccess } from '../../server/oauth/tokens.js'
import { listBlobPrefix } from '../../server/blob.js'
import { cleanName } from '../../server/admin/clean.js'
import { ADMIN_TOOLS, ADMIN_TOOL_REST_ROUTES } from '../../server/mcp/admin-tools.js'
import { APP_URL, setupTestDb } from './helpers/db.js'

const MCP = `${APP_URL}/api/mcp`
const CLIENT = 'xtc_admin_read_test'
const ADMIN_GITHUB_ID = 960015
const MODERN = '2026-07-28'
const ADMIN_TOOL_NAMES = ['admin_list_users', 'admin_get_user', 'admin_stats', 'admin_audit_log']

let db
let admin
let alice
let bob
let carol
let aliceDraft
let grantSeq = 0

beforeAll(async () => {
  db = await setupTestDb()
})

beforeEach(async () => {
  vi.mocked(listBlobPrefix).mockReset()
  vi.mocked(listBlobPrefix).mockResolvedValue({ files: [], truncated: false })
  await db.reset()
  await db.pg.exec('delete from oauth_clients')
  await db.pg.query("insert into oauth_clients (client_id, kind, client_name, redirect_uris) values ($1, 'registered', 'Admin read test', '{}')", [CLIENT])
})

afterEach(() => {
  vi.unstubAllEnvs()
})

const future = () => new Date(Date.now() + 24 * 60 * 60 * 1000)

/** A grant with its own client (so several grants can exist for one user). Returns the grant id. */
async function grantFor(user, { adminUntil = null, clientName = 'Admin read test' } = {}) {
  grantSeq += 1
  const client = `${CLIENT}_${grantSeq}`
  await db.pg.query(
    "insert into oauth_clients (client_id, kind, client_name, redirect_uris) values ($1, 'registered', $2, $3)",
    [client, clientName, ['https://claude.ai/api/mcp/auth_callback']]
  )
  const { rows } = await db.pg.query(
    'insert into oauth_grants (user_id, client_id, scope, resource, admin_until) values ($1, $2, $3, $4, $5) returning id',
    [user.id, client, 'drafts', MCP, adminUntil]
  )
  return rows[0].id
}

/** The caller of an elevated admin grant, as resolveAccess builds it from a real access token. */
async function elevatedCaller() {
  const grantId = await grantFor(admin, { adminUntil: future() })
  const pair = await issuePair(grantId)
  return { token: pair.access_token, caller: await resolveAccess(pair.access_token, MCP) }
}

/** A REST GET as the elevated admin, for the named admin tool (the guard needs adminTool set). */
const restAs = (caller, toolName, path) => runAs({ ...caller, adminTool: toolName }, () => route(new Request(`${APP_URL}/api${path}`, { method: 'GET' })))

/** One JSON-RPC call on the modern protocol, with a bearer token. Returns the parsed body. */
async function rpc(token, method, params = {}) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${token}`,
    'mcp-protocol-version': MODERN,
    'mcp-method': method
  }
  if (method === 'tools/call') headers['mcp-name'] = params.name
  const body = { jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN } } }
  const res = await route(new Request(MCP, { method: 'POST', headers, body: JSON.stringify(body) }))
  return JSON.parse(await res.text())
}

/** Seeds the fixed data set: four users (one suspended), drafts, posts, images, tokens, grants, share links, rate rows, one audit row. */
async function seedBaseline() {
  admin = await db.insertUser({ github_id: ADMIN_GITHUB_ID, login: 'shaked', name: 'Owner' })
  alice = await db.insertUser({ github_id: 1, login: 'alice', name: 'Alice Example' })
  bob = await db.insertUser({ github_id: 2, login: 'bob', name: 'Bob Example' })
  carol = await db.insertUser({ github_id: 3, login: 'carol', name: 'Carol Example' })
  await db.pg.query("update users set suspended_at = now(), suspended_reason = 'spam' where id = $1", [carol.id])

  // Alice: two drafts (one published), five posts, two images (one as a string, one as an object).
  aliceDraft = await db.insertDraft(alice.id, {
    title: 'SECRET_TITLE',
    is_published: true,
    published_at: new Date(),
    posts: [
      { id: 'p1', text: 'SECRET_TEXT', images: [{ url: `https://store.test/drafts/${alice.id}/d/SECRET_IMAGE.png` }], embeddedTweet: null },
      { id: 'p2', text: 'two', images: [], embeddedTweet: null },
      { id: 'p3', text: 'three', images: [], embeddedTweet: null }
    ]
  })
  await db.insertDraft(alice.id, {
    title: 'Second',
    posts: [
      { id: 'p4', text: 'four', images: [`https://store.test/drafts/${alice.id}/e/string.png`], embeddedTweet: null },
      { id: 'p5', text: 'five', images: [], embeddedTweet: null }
    ]
  })
  // Bob: one draft with no posts.
  await db.insertDraft(bob.id, { title: 'Empty', posts: [] })

  // Alice: one active token and one revoked token. Only the hash and prefix are stored, as in production.
  await db.pg.query(
    `insert into api_tokens (user_id, name, token_hash, token_prefix, created_via, last_used_at)
     values ($1, 'SECRET_TOKEN_NAME', 'HASHVALUE_ALICE_ACTIVE', 'PREFIXVAL1', 'web', now() - interval '1 hour'),
            ($1, 'old', 'HASHVALUE_ALICE_OLD', 'PREFIXVAL2', 'device', null)`,
    [alice.id]
  )
  await db.pg.query("update api_tokens set revoked_at = now() where token_hash = 'HASHVALUE_ALICE_OLD'")

  // Alice: one connected app (active) and one revoked. The client name is SECRET_CLIENT.
  const activeGrant = await grantFor(alice, { clientName: 'SECRET_CLIENT' })
  await db.pg.query('update oauth_grants set last_used_at = now() - interval \'2 hours\' where id = $1', [activeGrant])
  const revokedGrant = await grantFor(alice)
  await db.pg.query('update oauth_grants set revoked_at = now() where id = $1', [revokedGrant])

  // Alice: two share links on the first draft, one active and one already used (one-time).
  await db.pg.query(
    `insert into share_tokens (draft_id, created_by, used, one_time, expires_at)
     values ($1, $2, false, true, now() + interval '1 hour'),
            ($1, $2, true, true, now() + interval '1 hour')`,
    [aliceDraft.id, alice.id]
  )

  // Alice's MCP calls: 10 in the last hour, 5 three days ago, 100 ten days ago (outside 7 days).
  await db.pg.query(
    `insert into mcp_rate_limits (user_id, minute, calls) values
       ($1, date_trunc('minute', now()) - interval '1 hour', 10),
       ($1, date_trunc('minute', now()) - interval '3 days', 5),
       ($1, date_trunc('minute', now()) - interval '10 days', 100)`,
    [alice.id]
  )

  await db.pg.query(
    `insert into admin_audit (actor_user_id, actor_github_id, actor_login, action, outcome, target_user_id, target_github_id, target_login, details)
     values ($1, $2, 'shaked', 'elevate_connection', 'done', null, null, null, '{"hours": 24}')`,
    [admin.id, ADMIN_GITHUB_ID]
  )
}

/** The users page as the elevated admin sees it (REST). */
async function listAs(caller, query = '') {
  const res = await restAs(caller, 'admin_list_users', `/admin/users${query}`)
  return { status: res.status, body: await res.json() }
}

describe('counts: the users page, one user, the statistics (seeded numbers)', () => {
  it('the users page holds every seeded number for each user', async () => {
    await seedBaseline()
    const { caller } = await elevatedCaller()
    const { status, body } = await listAs(caller, '?limit=50')
    expect(status).toBe(200)
    expect(body.next_cursor).toBeNull()
    const row = (login) => body.users.find((user) => user.login === login)
    expect(body.users).toHaveLength(4)
    expect(row('alice')).toMatchObject({
      github_id: '1',
      drafts: 2,
      published_drafts: 1,
      posts: 5,
      images: 2,
      api_tokens_active: 1,
      api_tokens_total: 2,
      connected_apps: 1,
      share_links_active: 1,
      mcp_calls_24h: 10,
      mcp_calls_7d: 15,
      protected: false
    })
    expect(row('bob')).toMatchObject({ drafts: 1, published_drafts: 0, posts: 0, images: 0 })
    expect(row('carol')).toMatchObject({ suspended_reason: 'spam', drafts: 0 })
    expect(row('carol').suspended_at).not.toBeNull()
    expect(row('shaked').protected).toBe(true)
  })

  it('one user: the same counts, the token and app lists, and the image storage size', async () => {
    await seedBaseline()
    const { caller } = await elevatedCaller()
    vi.mocked(listBlobPrefix).mockResolvedValueOnce({
      files: [
        { url: 'https://store.test/a.png', size: 100 },
        { url: 'https://store.test/b.png', size: 50 }
      ],
      truncated: false
    })
    const res = await restAs(caller, 'admin_get_user', `/admin/users/${alice.id}`)
    expect(res.status).toBe(200)
    const { user } = await res.json()
    // One user's connected_apps is the list (plan A7 step 4 names it so), not the count of the users page.
    expect(user).toMatchObject({ login: 'alice', drafts: 2, posts: 5, images: 2, api_tokens_active: 1, image_files: 2, image_bytes: 150, image_files_truncated: false })
    expect(user.api_tokens).toHaveLength(2)
    expect(user.connected_apps).toHaveLength(2)
    expect(user.connected_apps.map((app) => app.redirect_host)).toEqual(['claude.ai', 'claude.ai'])
    expect(vi.mocked(listBlobPrefix)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(listBlobPrefix)).toHaveBeenCalledWith(`drafts/${alice.id}/`)
  })

  it('the statistics: totals, active users, and 30 days of signups that add up to the users', async () => {
    await seedBaseline()
    const { caller } = await elevatedCaller()
    const res = await restAs(caller, 'admin_stats', '/admin/stats')
    expect(res.status).toBe(200)
    const { stats } = await res.json()
    expect(stats).toMatchObject({
      users: 4,
      users_suspended: 1,
      drafts: 3,
      published_drafts: 1,
      posts: 5,
      images: 2,
      api_tokens_active: 1,
      connected_apps: 2, // alice's one active app and the admin's elevated grant
      share_links_active: 1,
      mcp_calls_24h: 10,
      mcp_calls_7d: 15
    })
    expect(stats.active_users_24h).toBeGreaterThanOrEqual(3)
    expect(stats.signups_by_day).toHaveLength(30)
    expect(stats.signups_by_day.reduce((sum, day) => sum + day.signups, 0)).toBe(4)
    expect(stats.signups_by_day.at(-1).signups).toBe(4)
  })

  it('the audit log holds the seeded row, with the login cleaned', async () => {
    await seedBaseline()
    const { caller } = await elevatedCaller()
    const res = await restAs(caller, 'admin_audit_log', '/admin/audit?limit=10')
    const { events } = await res.json()
    expect(events.find((event) => event.action === 'elevate_connection')).toMatchObject({ actor_login: 'shaked', outcome: 'done', details: { hours: 24 } })
  })
})

describe('paging, ties and the cursor', () => {
  it('five users with two equal creation times: three pages, each user once, in order', async () => {
    await db.reset()
    admin = await db.insertUser({ github_id: ADMIN_GITHUB_ID, login: 'shaked' })
    const stamp = '2026-11-01 10:00:00+00'
    const others = []
    for (const [i, when] of [
      [1, '2026-11-02 10:00:00+00'],
      [2, stamp],
      [3, stamp],
      [4, '2026-11-03 10:00:00+00']
    ]) {
      others.push(await db.insertUser({ github_id: i, login: `user${i}` }))
      await db.pg.query('update users set created_at = $2 where github_id = $1', [i, when])
    }
    await db.pg.query('update users set created_at = $2 where id = $1', [admin.id, '2026-11-04 10:00:00+00'])
    const { caller } = await elevatedCaller()
    const expected = (await db.pg.query('select id from users order by created_at desc, id desc')).rows.map((r) => r.id)

    const seen = []
    let cursor = null
    for (let page = 0; page < 3; page++) {
      const { status, body } = await listAs(caller, `?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
      expect(status).toBe(200)
      seen.push(...body.users.map((user) => user.id))
      cursor = body.next_cursor
      if (page < 2) expect(cursor).not.toBeNull()
    }
    expect(cursor).toBeNull()
    expect(seen).toEqual(expected)
    expect(new Set(seen).size).toBe(5)
    expect(others).toHaveLength(4)
  })

  it('a cursor that is not ours is 400, including a day that does not exist', async () => {
    await seedBaseline()
    const { caller } = await elevatedCaller()
    const make = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const cursors = [
      'not base64 !!',
      make('plain text'),
      make(['2026-11-19 05:10:18+00']),
      make(['yesterday', admin.id]),
      make(['2026-02-31 00:00:00+00', admin.id]),
      make(['2026-11-19 25:00:00+00', admin.id]),
      make(['2026-11-19 10:61:00+00', admin.id]),
      make(['2026-11-19 10:00:60+00', admin.id]),
      make(['2026-11-19 10:00:00+99', admin.id]),
      make(['0000-01-01 10:00:00+00', admin.id]),
      make(['2026-11-19 05:10:18+00', 'not-a-uuid'])
    ]
    for (const cursor of cursors) {
      const { status } = await listAs(caller, `?cursor=${encodeURIComponent(cursor)}`)
      expect(status).toBe(400)
    }
  })

  it('bad parameters are 400, and an unknown user id is 404', async () => {
    await seedBaseline()
    const { caller } = await elevatedCaller()
    const badQueries = ['?limit=0', '?limit=101', '?limit=x', '?limit=', '?q=a_b', '?q=', '?q=' + 'a'.repeat(40), '?status=nope', '?status=']
    for (const query of badQueries) expect((await listAs(caller, query)).status).toBe(400)
    for (const query of ['?limit=0', '?limit=101', '?before=yesterday', '?before=2026-02-31T00:00:00Z', '?before=0000-01-01T00:00:00Z', '?before=2026-01-01T00:00:00%2B20:00']) {
      expect((await restAs(caller, 'admin_audit_log', `/admin/audit${query}`)).status).toBe(400)
    }
    expect((await restAs(caller, 'admin_audit_log', '/admin/audit?before=2026-11-19T10:00:00Z')).status).toBe(200)
    expect((await restAs(caller, 'admin_get_user', '/admin/users/not-a-uuid')).status).toBe(404)
    expect((await restAs(caller, 'admin_get_user', '/admin/users/00000000-0000-0000-0000-000000000000')).status).toBe(404)
  })

  it('the status filter: active leaves out the suspended user, suspended keeps only that user', async () => {
    await seedBaseline()
    const { caller } = await elevatedCaller()
    const active = await listAs(caller, '?status=active')
    expect(active.body.users.map((u) => u.login).sort()).toEqual(['alice', 'bob', 'shaked'])
    const suspended = await listAs(caller, '?status=suspended')
    expect(suspended.body.users.map((u) => u.login)).toEqual(['carol'])
    const prefix = await listAs(caller, '?q=AL')
    expect(prefix.body.users.map((u) => u.login)).toEqual(['alice'])
  })
})

describe('text from users is cleaned', () => {
  it('a name with a control character, a bidi override and 300 letters comes back clean and 80 characters long', () => {
    const dirty = `\u0007Ann‮${'x'.repeat(300)}`
    const clean = cleanName(dirty)
    expect(Array.from(clean)).toHaveLength(80)
    expect(clean.startsWith('Annxxx')).toBe(true)
    expect(/[\p{Cc}\u202A-\u202E]/u.test(clean)).toBe(false)
    expect(cleanName(42)).toBeNull()
  })

  it('through the users page: a dirty name is cleaned and an invalid login is replaced', async () => {
    await seedBaseline()
    await db.insertUser({ github_id: 9, login: 'bad_login', name: `\u0007Ann‮${'x'.repeat(300)}` })
    const { caller } = await elevatedCaller()
    const { body } = await listAs(caller, '?limit=100')
    const dana = body.users.find((u) => u.github_id === '9')
    expect(dana.login).toBe('(invalid login)')
    expect(Array.from(dana.name)).toHaveLength(80)
    expect(/[\p{Cc}\u202A-\u202E]/u.test(dana.name)).toBe(false)
  })
})

describe('no secret reaches an admin answer', () => {
  const SECRETS = ['SECRET_TITLE', 'SECRET_TEXT', 'SECRET_TOKEN_NAME', 'SECRET_CLIENT', 'SECRET_IMAGE', 'HASHVALUE_ALICE_ACTIVE', 'PREFIXVAL1']
  const WORDS = ['token_hash', 'token_prefix', 'hash', 'prefix']

  it('no admin GET and no admin read tool answer holds draft text, names, token material or image URLs', async () => {
    await seedBaseline()
    vi.mocked(listBlobPrefix).mockResolvedValue({ files: [{ url: `https://store.test/drafts/${alice.id}/d/SECRET_IMAGE.png`, size: 9 }], truncated: false })
    const { caller, token } = await elevatedCaller()
    // Each answer must also succeed: a 500 or a tool error would otherwise pass the scan with nothing to scan.
    const answers = []
    for (const [name, path] of [
      ['admin_list_users', '/admin/users?limit=100'],
      ['admin_get_user', `/admin/users/${alice.id}`],
      ['admin_stats', '/admin/stats'],
      ['admin_audit_log', '/admin/audit']
    ]) {
      const res = await restAs(caller, name, path)
      expect(res.status).toBe(200)
      answers.push(await res.text())
    }
    for (const name of ADMIN_TOOL_NAMES) {
      const args = name === 'admin_get_user' ? { id: alice.id } : {}
      const body = await rpc(token, 'tools/call', { name, arguments: args })
      expect(body.result.isError).toBe(false)
      answers.push(JSON.stringify(body))
    }
    for (const text of answers) {
      for (const secret of SECRETS) expect(text).not.toContain(secret)
      for (const word of WORDS) expect(text.toLowerCase()).not.toContain(word)
    }
    // The stored token hash and prefix values are the ones that must not leak.
    expect(answers.join('')).toContain(alice.login)
  })
})

describe('the Blob listing only ever reads a user folder', () => {
  it('listBlobPrefix throws for any prefix but drafts/<uuid>/ (the real module, not the mock)', async () => {
    const actual = await vi.importActual('../../server/blob.js')
    expect(() => actual.listBlobPrefix('')).toThrow()
    expect(() => actual.listBlobPrefix('drafts/')).toThrow()
    expect(() => actual.listBlobPrefix('drafts/x/')).toThrow()
    expect(() => actual.listBlobPrefix('drafts/00000000-0000-0000-0000-000000000000/extra/')).toThrow()
  })
})

describe('normal users see no admin read tool', () => {
  it('a normal user calling each admin read tool gets the same answer as for a name that does not exist', async () => {
    await seedBaseline()
    const normal = await db.insertUser({ github_id: 50, login: 'dora' })
    const grantId = await grantFor(normal)
    const { access_token: token } = await issuePair(grantId).then((pair) => ({ access_token: pair.access_token }))
    const names = await rpc(token, 'tools/list')
    expect(names.result.tools.map((tool) => tool.name).filter((name) => name.startsWith('admin_'))).toEqual([])
    const made = await rpc(token, 'tools/call', { name: 'admin_nothing_here', arguments: {} })
    for (const name of ADMIN_TOOL_NAMES) {
      const real = await rpc(token, 'tools/call', { name, arguments: {} })
      expect(JSON.stringify(real.result)).toBe(JSON.stringify(made.result))
    }
  })

  it('the admin read tools are declared read-only and are in the registry', () => {
    for (const name of ADMIN_TOOL_NAMES) {
      expect(ADMIN_TOOLS.map((tool) => tool.name)).toContain(name)
    }
    expect(ADMIN_TOOL_REST_ROUTES).toEqual(expect.arrayContaining(['GET /admin/users', 'GET /admin/users/:id', 'GET /admin/stats', 'GET /admin/audit']))
  })
})
