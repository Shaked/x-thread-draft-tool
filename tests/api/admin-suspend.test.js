// @vitest-environment node
// Admin plan A8 (issue #196): suspend and unsuspend through the admin MCP tools. Fake seeded users only.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({
  putBlob: vi.fn(),
  deleteBlobUrls: vi.fn(async () => {}),
  listBlobPrefix: vi.fn(async () => ({ files: [], truncated: false }))
}))

import { route } from '../../server/router.js'
import { issuePair, resolveAccess } from '../../server/oauth/tokens.js'
import { createApiToken } from '../../server/tokens.js'
import { protectedGithubIds } from '../../server/admin/identity.js'
import { SUSPEND_SQL, UNSUSPEND_SQL } from '../../server/admin/queries.js'
import { APP_URL, apiRequest, setupTestDb } from './helpers/db.js'

const MCP = `${APP_URL}/api/mcp`
const CLIENT = 'xtc_admin_suspend_test'
const MODERN = '2026-07-28'
const ADMIN_GITHUB_ID = 960015

let db
let admin
let alice
let grantSeq = 0

beforeAll(async () => {
  db = await setupTestDb()
})

beforeEach(async () => {
  await db.reset()
  await db.pg.exec('delete from oauth_clients')
  // The audit log has no foreign keys, so a reset of the users does not clear it.
  await db.pg.exec('delete from admin_audit')
  await db.pg.query("insert into oauth_clients (client_id, kind, client_name, redirect_uris) values ($1, 'registered', 'Suspend test', '{}')", [CLIENT])
  admin = await db.insertUser({ github_id: ADMIN_GITHUB_ID, login: 'shaked', name: 'Owner' })
  alice = await db.insertUser({ github_id: 1, login: 'alice', name: 'Alice Example' })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

const future = () => new Date(Date.now() + 24 * 60 * 60 * 1000)

/** A grant for `user` with its own client. Returns the grant id. */
async function grantFor(user, { adminUntil = null } = {}) {
  grantSeq += 1
  const client = `${CLIENT}_${grantSeq}`
  await db.pg.query(
    "insert into oauth_clients (client_id, kind, client_name, redirect_uris) values ($1, 'registered', 'Suspend test', $2)",
    [client, ['https://claude.ai/api/mcp/auth_callback']]
  )
  const { rows } = await db.pg.query(
    'insert into oauth_grants (user_id, client_id, scope, resource, admin_until) values ($1, $2, $3, $4, $5) returning id',
    [user.id, client, 'drafts', MCP, adminUntil]
  )
  return rows[0].id
}

/** The elevated admin connection: its access token and the caller that resolveAccess builds from it. */
async function adminConnection() {
  const pair = await issuePair(await grantFor(admin, { adminUntil: future() }))
  return { token: pair.access_token, caller: await resolveAccess(pair.access_token, MCP) }
}

/** One JSON-RPC tools/call on the modern protocol. Returns the parsed body. */
async function call(token, name, args) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${token}`,
    'mcp-protocol-version': MODERN,
    'mcp-method': 'tools/call',
    'mcp-name': name
  }
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args, _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN } } }
  const res = await route(new Request(MCP, { method: 'POST', headers, body: JSON.stringify(body) }))
  return JSON.parse(await res.text())
}

/** tools/list on the modern protocol, for one connection. Returns the parsed body. */
async function rpcList(token) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${token}`,
    'mcp-protocol-version': MODERN,
    'mcp-method': 'tools/list'
  }
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN } } }
  const res = await route(new Request(MCP, { method: 'POST', headers, body: JSON.stringify(body) }))
  return JSON.parse(await res.text())
}

/** The answer of a tool call: `data` is the parsed JSON, or `{ error: text }` when the text is not JSON. */
function answer(body) {
  const text = body.result.content[0].text
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = { error: text }
  }
  return { isError: body.result.isError === true, data }
}

const loginStatus = (who) => db.pg.query('select suspended_at, suspended_reason from users where id = $1', [who.id]).then((r) => r.rows[0])
const auditRows = () => db.pg.query('select action, outcome, target_login, details from admin_audit order by created_at, id').then((r) => r.rows)

/** Probes of the target: its cookie, its xt_ token and its MCP token. Each answers 200 before and 403 when suspended. */
async function probes(user) {
  const cookie = await db.cookieFor(user)
  const { token: xt } = await createApiToken(user.id, { name: 'probe' })
  const pair = await issuePair(await grantFor(user))
  return {
    cookie: () => route(apiRequest('/api/drafts?published=false', { cookie })),
    xt: () => route(apiRequest('/api/drafts?published=false', { headers: { authorization: `Bearer ${xt}` } })),
    mcp: () =>
      route(
        new Request(MCP, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${pair.access_token}`, 'mcp-protocol-version': MODERN, 'mcp-method': 'tools/list' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN } } })
        })
      )
  }
}

describe('suspend and unsuspend through the admin tools', () => {
  it('suspend stops the cookie, the xt_ token and the MCP token at once; unsuspend restores them', async () => {
    const { token } = await adminConnection()
    const probe = await probes(alice)
    expect([(await probe.cookie()).status, (await probe.xt()).status, (await probe.mcp()).status]).toEqual([200, 200, 200])

    const suspended = answer(await call(token, 'admin_suspend_user', { id: alice.id, confirm_login: 'alice', reason: 'spam' }))
    expect(suspended).toMatchObject({ isError: false, data: { changed: true, user: { login: 'alice', suspended_reason: 'spam' } } })
    expect([(await probe.cookie()).status, (await probe.xt()).status, (await probe.mcp()).status]).toEqual([403, 403, 403])

    const restored = answer(await call(token, 'admin_unsuspend_user', { id: alice.id, confirm_login: 'alice' }))
    expect(restored).toMatchObject({ isError: false, data: { changed: true, user: { suspended_at: null } } })
    expect([(await probe.cookie()).status, (await probe.xt()).status, (await probe.mcp()).status]).toEqual([200, 200, 200])
  })

  it('a wrong confirm_login changes nothing and records nothing; a second suspend answers changed false', async () => {
    const { token } = await adminConnection()
    const wrong = answer(await call(token, 'admin_suspend_user', { id: alice.id, confirm_login: 'Alice' }))
    expect(wrong.isError).toBe(true)
    expect(wrong.data.error).toBe("confirm_login does not match this user's login")
    expect((await loginStatus(alice)).suspended_at).toBeNull()

    expect(answer(await call(token, 'admin_suspend_user', { id: alice.id, confirm_login: 'alice' })).data.changed).toBe(true)
    const again = answer(await call(token, 'admin_suspend_user', { id: alice.id, confirm_login: 'alice' }))
    expect(again.data.changed).toBe(false)
    expect((await auditRows()).map((row) => row.action)).toEqual(['suspend_user'])
  })

  it('the admin account and the CI identity are refused, and the SQL guard matches neither', async () => {
    const ci = await db.insertUser({ github_id: -1, login: 'ci-smoke', name: 'CI' })
    const { token } = await adminConnection()
    for (const who of [admin, ci]) {
      const refused = answer(await call(token, 'admin_suspend_user', { id: who.id, confirm_login: who.login }))
      expect(refused.isError).toBe(true)
      expect(refused.data.error).toBe('This account cannot be suspended or deleted.')
      const { rowCount } = await db.pg.query(SUSPEND_SQL, [who.id, 'x', protectedGithubIds()])
      expect(rowCount).toBe(0)
      expect((await loginStatus(who)).suspended_at).toBeNull()
    }
    expect((await auditRows()).map((row) => row.outcome)).toEqual(['refused', 'refused'])
    // The unsuspend guard, on real rows: the admin and the CI user are suspended directly, and must not match.
    const ciRow = await db.pg.query("select id from users where github_id = -1")
    await db.pg.query('update users set suspended_at = now() where id = any($1::uuid[])', [[admin.id, ciRow.rows[0].id]])
    const unsuspended = await db.pg.query(UNSUSPEND_SQL, [admin.id, protectedGithubIds()])
    expect(unsuspended.rowCount).toBe(0)
    expect((await loginStatus(admin)).suspended_at).not.toBeNull()
  })

  it('records the audit rows with the reason and the counts, and refuses a reason over 200 characters', async () => {
    const { token } = await adminConnection()
    await createApiToken(alice.id, { name: 'one' })
    const tooLong = answer(await call(token, 'admin_suspend_user', { id: alice.id, confirm_login: 'alice', reason: 'x'.repeat(201) }))
    expect(tooLong.isError).toBe(true)
    expect((await loginStatus(alice)).suspended_at).toBeNull()

    answer(await call(token, 'admin_suspend_user', { id: alice.id, confirm_login: 'alice', reason: 'spam' }))
    answer(await call(token, 'admin_unsuspend_user', { id: alice.id, confirm_login: 'alice' }))
    const rows = await auditRows()
    expect(rows.map((row) => [row.action, row.outcome, row.target_login])).toEqual([
      ['suspend_user', 'done', 'alice'],
      ['unsuspend_user', 'done', 'alice']
    ])
    expect(rows[0].details).toEqual({ reason: 'spam', counts: { api_tokens: 1, connected_apps: 0, share_links: 0 } })
    expect(JSON.stringify(rows)).not.toMatch(/token_hash|secret/)
  })

  it('suspend and unsuspend share the 30 an hour; refused rows do not count; the 31st answers 429', async () => {
    const { token } = await adminConnection()
    // 29 done rows of both kinds, and 5 refused rows that must not count.
    await db.pg.query(
      `insert into admin_audit (actor_user_id, actor_github_id, actor_login, action, outcome)
       select $1::uuid, $2::bigint, 'shaked', 'suspend_user', 'done' from generate_series(1, 19)
       union all select $1::uuid, $2::bigint, 'shaked', 'unsuspend_user', 'done' from generate_series(1, 10)
       union all select $1::uuid, $2::bigint, 'shaked', 'suspend_user', 'refused' from generate_series(1, 5)`,
      [admin.id, ADMIN_GITHUB_ID]
    )
    // The 30th action is still allowed: 29 done rows so far.
    expect(answer(await call(token, 'admin_suspend_user', { id: alice.id, confirm_login: 'alice' })).data.changed).toBe(true)
    // Now 30 done rows: the 31st answers 429 and changes nothing.
    const limited = answer(await call(token, 'admin_unsuspend_user', { id: alice.id, confirm_login: 'alice' }))
    expect(limited.isError).toBe(true)
    expect(limited.data.error).toBe('Admin limit reached: at most 30 of these actions per hour.')
    expect((await loginStatus(alice)).suspended_at).not.toBeNull()
  })

  it('a normal connection does not see the tools and calling one is an unknown tool', async () => {
    const pair = await issuePair(await grantFor(alice))
    const body = await call(pair.access_token, 'admin_suspend_user', { id: admin.id, confirm_login: 'shaked' })
    expect(body.error.code).toBe(-32602)
    expect(body.error.message).toMatch(/unknown tool/i)
    const listed = await rpcList(pair.access_token)
    expect(listed.result.tools.map((tool) => tool.name).filter((name) => name.startsWith('admin_'))).toEqual([])
    expect((await loginStatus(admin)).suspended_at).toBeNull()
    expect((await loginStatus(alice)).suspended_at).toBeNull()
  })
})
