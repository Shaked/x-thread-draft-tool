// @vitest-environment node
// #290 (E273 Task 16): the view-as start and end routes, their audit rows, the /auth/me fields and the limit.
import { decodeJwt } from 'jose'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({
  putBlob: vi.fn(),
  deleteBlobUrls: vi.fn(async () => {}),
  listBlobPrefix: vi.fn(async () => ({ files: [], truncated: false })),
  removeBlobPrefix: vi.fn(async () => ({ deleted: 0, remaining: 0, bytes: 0 }))
}))

import { route } from '../../server/router.js'
import { runAs } from '../../server/caller-context.js'
import { apiRequest, setupTestDb } from './helpers/db.js'

const HEADER = { 'x-xt-admin': '1' }
const NIL = '00000000-0000-4000-8000-000000000000'

let db
let admin
let alice
let ci
let suspended
let adminCookie

const call = (method, path, { body, cookie = adminCookie, headers = HEADER } = {}) => route(apiRequest(`/api${path}`, { method, body, cookie, headers }))
const start = (user_id, reason = 'support request') => call('POST', '/admin/view-as', { body: { user_id, reason } })
const cookieValue = (res, name) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`)).split(';')[0]
const audit = async (action) => (await db.pg.query('select * from admin_audit where action = $1 order by created_at, id', [action])).rows
const me = async (cookie) => (await (await call('GET', '/auth/me', { cookie, headers: {} })).json()).user

beforeAll(async () => {
  db = await setupTestDb()
})

beforeEach(async () => {
  await db.reset()
  await db.pg.query('delete from admin_audit')
  admin = await db.insertUser({ github_id: 960015, login: 'shaked' })
  alice = await db.insertUser({ github_id: 1, login: 'alice' })
  ci = await db.insertUser({ github_id: -1, login: 'ci-smoke' })
  suspended = await db.insertUser({ github_id: 2, login: 'sus' })
  await db.pg.query('update users set suspended_at = now() where id = $1', [suspended.id])
  adminCookie = await db.cookieFor(admin)
})

describe('POST /admin/view-as', () => {
  it('starts: sets a strict cookie, writes view_as_start with the reason and expires_at, vid is the row id', async () => {
    const res = await start(alice.id)
    expect(res.status).toBe(200)
    const set = res.headers.getSetCookie().find((c) => c.startsWith('xt_view_as='))
    expect(set).toMatch(/HttpOnly/)
    expect(set).toMatch(/SameSite=Strict/)
    expect(set).toMatch(/Max-Age=1800/)
    const [row] = await audit('view_as_start')
    expect(row).toMatchObject({ outcome: 'done', target_login: 'alice', actor_login: 'shaked' })
    expect(row.details).toMatchObject({ reason: 'support request', surface: 'web' })
    expect(Number.isNaN(Date.parse(row.details.expires_at))).toBe(false)
    expect(decodeJwt(set.split(';')[0].split('=')[1]).vid).toBe(row.id)
    expect((await me(`${adminCookie}; ${cookieValue(res, 'xt_view_as')}`)).login).toBe('alice')
  })

  it('refuses a protected, a suspended and a missing user, each with a refused row', async () => {
    expect((await start(admin.id)).status).toBe(403)
    expect((await start(ci.id)).status).toBe(403)
    expect((await start(suspended.id)).status).toBe(409)
    expect((await start(NIL)).status).toBe(404)
    const rows = await audit('view_as_start')
    expect(rows.map((r) => [r.outcome, r.details.why])).toEqual([['refused', 'protected'], ['refused', 'protected'], ['refused', 'suspended'], ['refused', 'missing']])
  })

  it('needs a reason of 3 to 200 characters and a user id', async () => {
    for (const reason of [undefined, 'ab', '  ', 'x'.repeat(201), 5]) {
      expect((await call('POST', '/admin/view-as', { body: { user_id: alice.id, reason } })).status).toBe(400)
    }
    expect((await call('POST', '/admin/view-as', { body: { user_id: 'nope', reason: 'support' } })).status).toBe(400)
    expect(await audit('view_as_start')).toHaveLength(0)
  })

  it('is closed to everyone but the admin web session, and to MCP', async () => {
    expect((await call('POST', '/admin/view-as', { body: { user_id: alice.id, reason: 'support' }, headers: {} })).status).toBe(404)
    const normal = await db.cookieFor(alice)
    expect((await call('POST', '/admin/view-as', { body: { user_id: alice.id, reason: 'support' }, cookie: normal })).status).toBe(404)
    const caller = { uid: admin.id, gh: '960015', login: 'shaked', via: 'token', suspended: false, adminTool: 'admin_status' }
    const mcp = await runAs(caller, () => route(apiRequest('/api/admin/view-as', { method: 'POST', body: { user_id: alice.id, reason: 'support' } })))
    expect(mcp.status).toBe(404)
  })

  it('refuses the 31st start in an hour', async () => {
    for (let i = 0; i < 30; i++) expect((await start(alice.id)).status).toBe(200)
    expect((await start(alice.id)).status).toBe(429)
  })
})

describe('/auth/me while viewing', () => {
  it('returns view_as, actor and the real role', async () => {
    const res = await start(alice.id)
    const user = await me(`${adminCookie}; ${cookieValue(res, 'xt_view_as')}`)
    expect(user.login).toBe('alice')
    expect(user.role).toBe('admin')
    expect(user.actor).toEqual({ login: 'shaked' })
    expect(user.view_as).toMatchObject({ login: 'alice', user_id: alice.id })
    expect(Number.isNaN(Date.parse(user.view_as.expires_at))).toBe(false)
  })

  it('is unchanged outside view-as', async () => {
    const user = await me(adminCookie)
    expect(user.role).toBe('admin')
    expect(user.view_as).toBeUndefined()
    expect(user.actor).toBeUndefined()
    const normal = await me(await db.cookieFor(alice))
    expect(normal.role).toBe('user')
    expect(normal.view_as).toBeUndefined()
  })
})

describe('DELETE /admin/view-as', () => {
  it('clears the cookie, writes view_as_end, and the old claim value no longer works', async () => {
    const started = await start(alice.id)
    const claim = cookieValue(started, 'xt_view_as')
    const both = `${adminCookie}; ${claim}`
    expect((await me(both)).login).toBe('alice')
    const res = await call('DELETE', '/admin/view-as', { cookie: both })
    expect(res.status).toBe(200)
    expect(res.headers.getSetCookie().find((c) => c.startsWith('xt_view_as='))).toMatch(/Max-Age=0/)
    const [end] = await audit('view_as_end')
    const [begin] = await audit('view_as_start')
    expect(end).toMatchObject({ outcome: 'done', target_login: 'alice' })
    expect(end.details.vid).toBe(begin.id)
    // Replay: the same cookie value, still unexpired, is dead.
    expect((await me(both)).login).toBe('shaked')
    // A new start gets a new vid and works.
    const again = await start(alice.id)
    expect((await me(`${adminCookie}; ${cookieValue(again, 'xt_view_as')}`)).login).toBe('alice')
  })

  it('without a live claim clears the cookie and writes no row', async () => {
    const res = await call('DELETE', '/admin/view-as')
    expect(res.status).toBe(200)
    expect(await audit('view_as_end')).toHaveLength(0)
  })
})

describe('MCP surface', () => {
  it('lists no view-as tool', async () => {
    const { ADMIN_TOOLS } = await import('../../server/mcp/admin-tools.js')
    expect(ADMIN_TOOLS.map((t) => t.name).filter((n) => /view/.test(n))).toEqual([])
  })
})
