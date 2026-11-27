// @vitest-environment node
// Admin plan A9 (issue #199): delete a user and all their content. Fake seeded users and an in-memory Blob only.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignJWT } from 'jose'

// recordAdminAction can be made to throw once, for the 'done' row (the transaction failure case).
const auditFault = vi.hoisted(() => ({ failDoneOnce: false }))
vi.mock('../../server/admin/audit.js', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    recordAdminAction: async (run, entry) => {
      if (auditFault.failDoneOnce && entry.outcome === 'done') {
        auditFault.failDoneOnce = false
        throw new Error('audit write failed')
      }
      return real.recordAdminAction(run, entry)
    }
  }
})

import { route } from '../../server/router.js'
import { issuePair, resolveAccess, rotate } from '../../server/oauth/tokens.js'
import { sealDecision } from '../../server/oauth/consent.js'
import { createApiToken } from '../../server/tokens.js'
import { secretKey } from '../../server/session.js'
import { protectedGithubIds } from '../../server/admin/identity.js'
import { DELETE_SQL } from '../../server/admin/delete-user.js'
import { removeBlobPrefix, setBlobImpl } from '../../server/blob.js'
import { APP_URL, apiRequest, setupTestDb } from './helpers/db.js'

const MCP = `${APP_URL}/api/mcp`
const MODERN = '2026-07-28'
const CLIENT = 'xtc_admin_delete_test'
const BASE = 'https://blob.test/'

let db
let admin
let grantSeq = 0
const blob = { files: new Map(), delCalls: [], failDelOnce: false }

beforeAll(async () => {
  db = await setupTestDb()
  setBlobImpl({
    put: async () => ({}),
    del: async (urls) => {
      if (blob.failDelOnce) {
        blob.failDelOnce = false
        throw new Error('blob backend down')
      }
      blob.delCalls.push(urls)
      for (const url of urls) blob.files.delete(url)
    },
    list: async ({ prefix, limit }) => {
      const all = [...blob.files].filter(([url]) => url.startsWith(`${BASE}${prefix}`))
      return { files: all.slice(0, limit).map(([url, size]) => ({ url, size })), truncated: all.length > limit }
    },
    key: (url) => (url.startsWith(BASE) ? url.slice(BASE.length) : null)
  })
})

beforeEach(async () => {
  await db.reset()
  await db.pg.exec('delete from oauth_clients')
  await db.pg.exec('delete from admin_audit')
  blob.files.clear()
  blob.delCalls = []
  blob.failDelOnce = false
  auditFault.failDoneOnce = false
  admin = await db.insertUser({ github_id: 960015, login: 'shaked', name: 'Owner' })
})

afterEach(() => vi.useRealTimers())

const addFiles = (user, n) => {
  for (let i = 0; i < n; i += 1) blob.files.set(`${BASE}drafts/${user.id}/d/f${i}.png`, 10)
}

/** A grant for `user` with its own client. Returns the grant id. */
async function grantFor(user, adminUntil = null) {
  grantSeq += 1
  const client = `${CLIENT}_${grantSeq}`
  await db.pg.query("insert into oauth_clients (client_id, kind, client_name, redirect_uris) values ($1, 'registered', 'Delete test', $2)", [client, ['https://claude.ai/api/mcp/auth_callback']])
  const { rows } = await db.pg.query('insert into oauth_grants (user_id, client_id, scope, resource, admin_until) values ($1, $2, $3, $4, $5) returning id', [user.id, client, 'drafts', MCP, adminUntil])
  return rows[0].id
}

async function adminConnection() {
  const grantId = await grantFor(admin, new Date(Date.now() + 86_400_000))
  const pair = await issuePair(grantId)
  return { token: pair.access_token, grantId }
}

async function call(token, name, args) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}`, 'mcp-protocol-version': MODERN, 'mcp-method': 'tools/call', 'mcp-name': name }
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args, _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN } } }
  const res = await route(new Request(MCP, { method: 'POST', headers, body: JSON.stringify(body) }))
  const parsed = JSON.parse(await res.text())
  const text = parsed.result?.content?.[0]?.text
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = { error: text }
  }
  return { isError: parsed.result?.isError === true, data, parsed }
}

const remove = (token, user, extra = {}) => call(token, 'admin_delete_user', { id: user.id, ...extra })
const dry = (token, user) => remove(token, user)
const real = (token, user, confirm_token, confirm_login = user.login) => remove(token, user, { dry_run: false, confirm_token, confirm_login })

/** A user, suspended `minutes` ago by SQL, with files. */
async function target(login, githubId, { minutes = 11, files = 2 } = {}) {
  const user = await db.insertUser({ github_id: githubId, login, name: login })
  await db.pg.query("update users set suspended_at = now() - make_interval(mins => $2) where id = $1", [user.id, minutes])
  addFiles(user, files)
  return user
}

const rowsOf = (table, column, id) => db.pg.query(`select count(*)::int as n from ${table} where ${column} = $1`, [id]).then((r) => r.rows[0].n)
const userExists = (user) => rowsOf('users', 'id', user.id).then((n) => n === 1)
const audit = () => db.pg.query('select outcome, target_user_id, target_github_id, target_login, details from admin_audit where action = $1 order by created_at, id', ['delete_user']).then((r) => r.rows)
const fileCount = (user) => [...blob.files.keys()].filter((url) => url.includes(`drafts/${user.id}/`)).length

/** Gives a user one row in every counted table. Returns its credentials. */
async function seedContent(user) {
  const draft = await db.insertDraft(user.id)
  await db.pg.query('insert into share_tokens (draft_id, created_by) values ($1, $2)', [draft.id, user.id])
  await db.pg.query("insert into mcp_rate_limits (user_id, minute, calls) values ($1, date_trunc('minute', now()), 1)", [user.id])
  const { token: xt } = await createApiToken(user.id, { name: 'seed' })
  const pair = await issuePair(await grantFor(user))
  return { cookie: await db.cookieFor(user), xt, pair }
}

describe('admin_delete_user', () => {
  it('refuses a user who is not suspended or suspended less than 10 minutes; a dry run changes nothing', async () => {
    const { token } = await adminConnection()
    const fresh = await db.insertUser({ github_id: 1, login: 'fresh', name: 'F' })
    expect((await dry(token, fresh)).data.error).toBe('Suspend the user first (admin_suspend_user, or Suspend on the admin page).')
    const early = await target('early', 2, { minutes: 5 })
    expect((await dry(token, early)).data.error).toMatch(/^Wait until .*: a user must be suspended for 10 minutes before deletion\.$/)
    const ready = await target('ready', 3)
    await seedContent(ready)
    const before = (await db.pg.query('select count(*)::int as n from drafts')).rows[0].n
    const out = await dry(token, ready)
    expect(out.data).toMatchObject({ dry_run: true, user: { id: ready.id, login: 'ready' }, expires_in: 600, will_delete: { drafts: 1, share_links: 1, api_tokens: 1, connected_apps: 1, oauth_tokens: 2, mcp_rate_rows: 1, image_files: 2, draft_revisions: 1, revision_posts: 1 } })
    expect(typeof out.data.confirm_token).toBe('string')
    expect(blob.delCalls).toEqual([])
    expect((await db.pg.query('select count(*)::int as n from drafts')).rows[0].n).toBe(before)
    expect(await audit()).toEqual([])
  })

  it('deletes the user, the rows and the files, and nothing of another user; old credentials stop; audit has started and done', async () => {
    const { token } = await adminConnection()
    const gone = await target('gone', 10, { files: 3 })
    const other = await target('other', 11, { files: 2 })
    const creds = await seedContent(gone)
    await seedContent(other)
    const out = await dry(token, gone)
    const done = await real(token, gone, out.data.confirm_token)
    expect(done.data).toMatchObject({ deleted: true, user: { id: gone.id, login: 'gone' }, files_deleted: 3, bytes_deleted: 30, removed: out.data.will_delete })

    for (const [table, column] of [['users', 'id'], ['drafts', 'user_id'], ['api_tokens', 'user_id'], ['oauth_grants', 'user_id'], ['share_tokens', 'created_by'], ['mcp_rate_limits', 'user_id']]) {
      expect(await rowsOf(table, column, gone.id)).toBe(0)
    }
    expect((await db.pg.query('select count(*)::int as n from oauth_tokens t join oauth_grants g on g.id = t.grant_id where g.user_id = $1', [gone.id])).rows[0].n).toBe(0)
    expect(fileCount(gone)).toBe(0)
    // The revision rows of the deleted user's draft went with it; the other user's remain (one draft, one post each).
    expect((await db.pg.query('select (select count(*)::int from draft_revisions) as r, (select count(*)::int from draft_post_versions) as v')).rows[0]).toEqual({ r: 1, v: 1 })
    expect(await userExists(other)).toBe(true)
    expect(fileCount(other)).toBe(2)
    for (const [table, column] of [['drafts', 'user_id'], ['api_tokens', 'user_id'], ['oauth_grants', 'user_id'], ['share_tokens', 'created_by'], ['mcp_rate_limits', 'user_id']]) {
      expect(await rowsOf(table, column, other.id)).toBe(1)
    }
    expect(blob.delCalls.flat().every((url) => url.startsWith(`${BASE}drafts/${gone.id}/`))).toBe(true)

    const rows = await audit()
    expect(rows.map((row) => row.outcome)).toEqual(['started', 'done'])
    expect(rows[1]).toMatchObject({ target_user_id: gone.id, target_github_id: 10, target_login: 'gone', details: { counts: out.data.will_delete, files_deleted: 3, bytes_deleted: 30 } })

    expect((await route(apiRequest('/api/drafts?published=false', { cookie: creds.cookie }))).status).toBe(401)
    expect((await route(apiRequest('/api/drafts?published=false', { headers: { authorization: `Bearer ${creds.xt}` } }))).status).toBe(401)
    expect(await resolveAccess(creds.pair.access_token, MCP)).toBeNull()
    await expect(rotate(creds.pair.refresh_token, undefined, MCP)).rejects.toThrow()
    // The same token again, within its 10 minutes: the user is gone.
    const again = await real(token, gone, out.data.confirm_token)
    expect(again.data.error).toBe('User not found')
    expect((await audit()).length).toBe(2)
  })

  it('refuses a wrong login, another target, another connection, an expired token, a changed count and look-alike tokens', async () => {
    const { token, grantId } = await adminConnection()
    const alice = await target('alice', 20)
    const bob = await target('bob', 21)
    const minted = (await dry(token, alice)).data.confirm_token
    const bobToken = (await dry(token, bob)).data.confirm_token
    const claims = { act: 'delete_user', target: alice.id, gh: '20', login: 'alice', counts: (await dry(token, alice)).data.will_delete, admin: admin.id, surface: 'mcp', bind: grantId }
    const sign = (payload, exp) => new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).setAudience('admin-confirm').setIssuedAt(Math.floor(Date.now() / 1000) - 1200).setExpirationTime(exp).sign(secretKey())
    const otherGrant = { ...claims, bind: '00000000-0000-0000-0000-000000000000' }
    const emptyBind = await sign({ ...claims, bind: '' }, '10m')
    const expired = await sign(claims, Math.floor(Date.now() / 1000) - 60)
    const otherAdmin = await sign(otherGrant, '10m')
    const decision = await sealDecision({ client_id: 'x', redirect_uri: 'https://claude.ai/api/mcp/auth_callback' })
    const attempts = [
      real(token, alice, minted, 'Alice'),
      real(token, alice, bobToken),
      real(token, alice, otherAdmin),
      real(token, alice, expired),
      real(token, alice, emptyBind),
      real(token, alice, await db.cookieFor(alice).then((c) => c.replace('xt_session=', ''))),
      real(token, alice, decision),
      real(token, alice, undefined)
    ]
    for (const attempt of await Promise.all(attempts)) expect(attempt.isError).toBe(true)
    // A draft added by SQL after the dry run: the counts no longer match.
    await db.insertDraft(alice.id)
    expect((await real(token, alice, minted)).data.error).toBe('The content changed. Run the dry run again.')
    expect(await userExists(alice)).toBe(true)
    expect(fileCount(alice)).toBe(2)
    expect(blob.delCalls).toEqual([])
    expect(await audit()).toEqual([])
  })

  it('a failed file step answers 502 and keeps every row; the retry succeeds', async () => {
    const { token } = await adminConnection()
    const alice = await target('alice', 30)
    await seedContent(alice)
    blob.failDelOnce = true
    const first = await real(token, alice, (await dry(token, alice)).data.confirm_token)
    expect(first.data.error).toBe('Some image files could not be deleted. Nothing else was removed. Run the dry run and the delete again.')
    expect(first.isError).toBe(true)
    expect(await userExists(alice)).toBe(true)
    expect(await rowsOf('drafts', 'user_id', alice.id)).toBe(1)
    expect((await db.pg.query('select suspended_at from users where id = $1', [alice.id])).rows[0].suspended_at).not.toBeNull()
    expect((await audit()).map((row) => row.outcome)).toEqual(['started', 'failed'])
    expect((await audit())[1].details).toMatchObject({ stage: 'files' })

    const retry = await real(token, alice, (await dry(token, alice)).data.confirm_token)
    expect(retry.data.deleted).toBe(true)
    expect(await userExists(alice)).toBe(false)
  })

  it('a failed transaction rolls back; the retry succeeds with files_deleted 0', async () => {
    const { token } = await adminConnection()
    const alice = await target('alice', 40)
    await seedContent(alice)
    auditFault.failDoneOnce = true
    const first = await real(token, alice, (await dry(token, alice)).data.confirm_token)
    expect(first.isError).toBe(true)
    expect(await userExists(alice)).toBe(true)
    expect(await rowsOf('drafts', 'user_id', alice.id)).toBe(1)
    expect((await audit()).map((row) => [row.outcome, row.details.stage])).toEqual([['started', undefined], ['failed', 'db']])
    const retry = await real(token, alice, (await dry(token, alice)).data.confirm_token)
    expect(retry.data).toMatchObject({ deleted: true, files_deleted: 0 })
    expect(await userExists(alice)).toBe(false)
  })

  it('removes more than 1000 files and reports remaining 0; a bad prefix throws and calls nothing', async () => {
    const alice = await target('alice', 50, { files: 2500 })
    const result = await removeBlobPrefix(`drafts/${alice.id}/`)
    const preview = await dry((await adminConnection()).token, await target('big', 51, { files: 1001 }))
    expect(preview.data.will_delete).toMatchObject({ image_files: 1000, image_files_truncated: true })
    expect(result).toEqual({ deleted: 2500, bytes: 25000, remaining: 0 })
    expect(blob.delCalls.map((urls) => urls.length)).toEqual([1000, 1000, 500])
    blob.delCalls = []
    for (const prefix of ['', 'drafts/', 'drafts/../', 'drafts/x/', undefined]) await expect(removeBlobPrefix(prefix)).rejects.toThrow()
    expect(blob.delCalls).toEqual([])
  })

  it('two deletes at once for the same user: one deletes, the other answers 404 and records reason gone', async () => {
    const { token } = await adminConnection()
    const alice = await target('alice', 60)
    const other = await target('other', 61)
    await seedContent(alice)
    await seedContent(other)
    const confirm = (await dry(token, alice)).data.confirm_token
    const results = await Promise.all([real(token, alice, confirm), real(token, alice, confirm)])
    expect(results.map((r) => r.data.deleted ?? r.data.error).sort()).toEqual(['User not found', true])
    const rows = await audit()
    expect(rows.filter((r) => r.outcome === 'done')).toHaveLength(1)
    expect(rows.filter((r) => r.outcome === 'failed').map((r) => r.details.reason)).toEqual(['gone'])
    expect(await rowsOf('drafts', 'user_id', other.id)).toBe(1)
    expect(fileCount(other)).toBe(2)
  })

  it('counts started rows for the hourly limit: 4 deleted and 1 failed run, then 429', async () => {
    const { token } = await adminConnection()
    for (let i = 0; i < 4; i += 1) {
      const user = await target(`user${i}`, 100 + i, { files: 0 })
      const r = await real(token, user, (await dry(token, user)).data.confirm_token); expect(r.data).toMatchObject({ deleted: true })
    }
    const failing = await target('failing', 110)
    blob.failDelOnce = true
    expect((await real(token, failing, (await dry(token, failing)).data.confirm_token)).isError).toBe(true)
    const sixth = await target('sixth', 111)
    const limited = await real(token, sixth, (await dry(token, sixth)).data.confirm_token)
    expect(limited.data.error).toMatch(/^Admin limit reached: at most 5 of these actions per hour\./)
    expect(await userExists(sixth)).toBe(true)
  })

  it('refuses the admin and the CI identity in both modes, and the SQL matches neither', async () => {
    const { token } = await adminConnection()
    const ci = await db.insertUser({ github_id: -1, login: 'ci-smoke', name: 'CI' })
    await db.pg.query("update users set suspended_at = now() - interval '1 hour' where id = $1", [ci.id])
    for (const who of [admin, ci]) {
      const first = await dry(token, who)
      const second = await real(token, who, 'x')
      for (const refused of [first, second]) expect(refused.data.error).toBe('This account cannot be suspended or deleted.')
      expect((await db.pg.query(DELETE_SQL, [who.id, protectedGithubIds()])).rowCount).toBe(0)
      expect(await userExists(who)).toBe(true)
    }
  })

  it('unsuspend is refused while a delete of that user is running, and allowed after it failed', async () => {
    const { token } = await adminConnection()
    const alice = await target('alice', 80)
    const note = (outcome) => db.pg.query("insert into admin_audit (actor_user_id, actor_github_id, actor_login, action, outcome, target_user_id, target_github_id, target_login) values ($1, 960015, 'shaked', 'delete_user', $2, $3, 80, 'alice')", [admin.id, outcome, alice.id])
    await note('started')
    const refused = await call(token, 'admin_unsuspend_user', { id: alice.id, confirm_login: 'alice' })
    expect(refused.data.error).toBe('A deletion of this user is running. Try again in a few minutes.')
    expect((await db.pg.query('select suspended_at from users where id = $1', [alice.id])).rows[0].suspended_at).not.toBeNull()
    await note('failed')
    expect((await call(token, 'admin_unsuspend_user', { id: alice.id, confirm_login: 'alice' })).data.changed).toBe(true)
  })

  it('a normal user does not get the tool', async () => {
    const alice = await db.insertUser({ github_id: 70, login: 'alice', name: 'A' })
    const pair = await issuePair(await grantFor(alice))
    const out = await call(pair.access_token, 'admin_delete_user', { id: alice.id })
    const made = await call(pair.access_token, 'admin_zz', { id: alice.id })
    expect(JSON.stringify(out.parsed).replaceAll('admin_delete_user', 'N')).toEqual(JSON.stringify(made.parsed).replaceAll('admin_zz', 'N'))
  })
})

// #284 (E273 Task 10): a confirm token is bound to its surface and to its binding (the MCP grant, or the browser session's jti).
describe('web admin safety (#284)', () => {
  const WEB = { 'x-xt-admin': '1' }
  const webCall = (cookie, path, body) => route(apiRequest(`/api/admin/users/${path}/delete`, { method: 'POST', body, cookie, headers: WEB }))
  const webDry = async (cookie, user) => (await webCall(cookie, user.id, {})).json()
  const webReal = (cookie, user, confirm_token) => webCall(cookie, user.id, { dry_run: false, confirm_token, confirm_login: user.login })

  it('a web token never opens on MCP, an MCP token never opens on web, another browser session is refused', async () => {
    const alice = await target('alice', 20)
    const { token } = await adminConnection()
    const cookie = await db.cookieFor(admin)
    const webToken = (await webDry(cookie, alice)).confirm_token
    const mcpToken = (await dry(token, alice)).data.confirm_token
    expect((await real(token, alice, webToken)).data.error).toBe('confirm_token is not valid for this call. Run the dry run again.')
    const refusal = 'confirm_token is not valid for this call. Run the dry run again.'
    const mcpOnWeb = await webReal(cookie, alice, mcpToken)
    expect(mcpOnWeb.status).toBe(400)
    expect((await mcpOnWeb.json()).error).toBe(refusal)
    const otherSession = await db.cookieFor(admin)
    const otherWeb = await webReal(otherSession, alice, webToken)
    expect(otherWeb.status).toBe(400)
    expect((await otherWeb.json()).error).toBe(refusal)
    // Right binding, wrong surface: a token minted for the MCP connection's grant id, presented on web with that value as its jti.
    const signTok = (payload) => new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).setAudience('admin-confirm').setIssuedAt().setExpirationTime('10m').sign(secretKey())
    const forged = await signTok({ act: 'delete_user', target: alice.id, gh: '20', login: 'alice', counts: (await dry(token, alice)).data.will_delete, admin: admin.id, surface: 'web', bind: (await adminConnection()).grantId })
    const forgedRes = await webReal(cookie, alice, forged)
    expect(forgedRes.status).toBe(400)
    expect(await userExists(alice)).toBe(true)
  })

  it('writes the surface on every audit row: web for the browser, mcp for the connection', async () => {
    const bob = await target('bob', 21)
    const cookie = await db.cookieFor(admin)
    const webRes = await webReal(cookie, bob, (await webDry(cookie, bob)).confirm_token)
    expect(webRes.status).toBe(200)
    const carol = await target('carol', 22)
    const { token } = await adminConnection()
    expect((await real(token, carol, (await dry(token, carol)).data.confirm_token)).isError).toBe(false)
    const rows = await audit()
    const surfaceOf = (id) => rows.filter((r) => r.target_user_id === id).map((r) => r.details.surface)
    expect(surfaceOf(bob.id).length).toBeGreaterThan(0)
    expect(new Set(surfaceOf(bob.id))).toEqual(new Set(['web']))
    expect(new Set(surfaceOf(carol.id))).toEqual(new Set(['mcp']))
  })

  it('a web write needs a sign-in from the last 7 days (6 days passes, 8 days is refused); a read does not (#552)', async () => {
    const alice = await target('alice', 20)
    const sessionAt = (daysAgo) =>
      new SignJWT({ uid: admin.id, gh: '960015', login: 'shaked', jti: `old-${daysAgo}` })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt(Math.floor(Date.now() / 1000) - daysAgo * 86400)
        .setExpirationTime('30d')
        .sign(secretKey())
        .then((t) => `xt_session=${t}`)
    const fresh = await sessionAt(6)
    const stale = await sessionAt(8)
    expect((await webCall(fresh, alice.id, {})).status).toBe(200)
    const refused = await webCall(stale, alice.id, {})
    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual({ error: 'Sign in again: admin changes on the web need a sign-in from the last 7 days.', code: 'sign_in_again' })
    const read = await route(apiRequest(`/api/admin/users/${alice.id}`, { cookie: stale, headers: WEB }))
    expect(read.status).toBe(200)
  })
})
