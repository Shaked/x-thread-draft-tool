// @vitest-environment node
// #289 (E273 Task 15): the view-as claim. The claim is sealed in the test (the start route is Task 16). Seeded once.
import { decodeJwt } from 'jose'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({
  putBlob: vi.fn(),
  deleteBlobUrls: vi.fn(async () => {}),
  listBlobPrefix: vi.fn(async () => ({ files: [], truncated: false })),
  removeBlobPrefix: vi.fn(async () => ({ deleted: 0, remaining: 0, bytes: 0 }))
}))

import { ROUTES, route } from '../../server/router.js'
import { clearViewAsCookie, sealViewAs } from '../../server/admin/view-as.js'
import { readSession, secretKey } from '../../server/session.js'
import { createApiToken } from '../../server/tokens.js'
import { SignJWT } from 'jose'
import { apiRequest, setupTestDb } from './helpers/db.js'

const NIL = '00000000-0000-4000-8000-000000000000'
const SECRET_TEXT = 'a private sentence the admin must never read'

let db
let admin
let alice
let ci
let gone
let suspended
let adminCookie
let adminJti
let normalCookie
let otherAdminCookie
let draft
let xtToken

const claimFor = (target, over = {}, now) =>
  sealViewAs(
    {
      adminUid: admin.id,
      adminJti,
      targetUid: target.id,
      targetGh: target.github_id,
      targetLogin: target.login,
      reason: 'test',
      vid: 'v1',
      ...over
    },
    now
  )
const withClaim = async (target, over, now, cookie = adminCookie) => `${cookie}; xt_view_as=${await claimFor(target, over, now)}`
const call = (method, path, { body, cookie, headers } = {}) => route(apiRequest(`/api${path}`, { method, body, cookie, headers }))
const me = async (cookie, headers) => (await (await call('GET', '/auth/me', { cookie, headers })).json()).user

beforeAll(async () => {
  db = await setupTestDb()
  await db.reset()
  admin = await db.insertUser({ github_id: 960015, login: 'shaked' })
  alice = await db.insertUser({ github_id: 1, login: 'alice' })
  ci = await db.insertUser({ github_id: -1, login: 'ci-smoke' })
  suspended = await db.insertUser({ github_id: 2, login: 'sus' })
  await db.pg.query('update users set suspended_at = now() where id = $1', [suspended.id])
  gone = { id: '11111111-1111-4111-8111-111111111111', github_id: 3, login: 'gone' }
  adminCookie = await db.cookieFor(admin)
  adminJti = decodeJwt(adminCookie.split('=')[1]).jti
  otherAdminCookie = await db.cookieFor(admin)
  normalCookie = await db.cookieFor(alice)
  draft = await db.insertDraft(alice.id, { title: 'Secret title', posts: [{ id: 'p1', text: SECRET_TEXT, images: [], embeddedTweet: null }] })
  xtToken = (await createApiToken(admin.id, { name: 'view-as test' })).token
})

describe('the view-as claim in authenticate', () => {
  it('applies a valid claim for the admin session: the caller is the target', async () => {
    const user = await me(await withClaim(alice))
    expect(user.login).toBe('alice')
    // The role is the real session's (#290), so the admin UI stays while viewing.
    expect(user.role).toBe('admin')
  })

  it('a claim with no session gives null', async () => {
    expect(await me(`xt_view_as=${await claimFor(alice)}`)).toBeNull()
  })

  it('ignores a claim made for another session (another jti)', async () => {
    expect((await me(await withClaim(alice, { adminJti: 'someone-elses-jti' }))).login).toBe('shaked')
    expect((await me(await withClaim(alice, {}, undefined, otherAdminCookie))).login).toBe('shaked')
    expect((await me(await withClaim(alice, { adminUid: alice.id }))).login).toBe('shaked')
  })

  it('ignores a claim on a non-admin session', async () => {
    const claim = await sealViewAs({ adminUid: alice.id, adminJti: decodeJwt(normalCookie.split('=')[1]).jti, targetUid: admin.id, targetGh: '960015', targetLogin: 'shaked', reason: 't', vid: 'v' })
    expect((await me(`${normalCookie}; xt_view_as=${claim}`)).login).toBe('alice')
    const other = await sealViewAs({ adminUid: alice.id, adminJti: decodeJwt(normalCookie.split('=')[1]).jti, targetUid: suspended.id, targetGh: '2', targetLogin: 'sus', reason: 't', vid: 'v' })
    expect((await me(`${normalCookie}; xt_view_as=${other}`)).login).toBe('alice')
  })

  it('ignores a claim for an admin, a CI target, a gone target and a suspended target', async () => {
    for (const target of [admin, ci, gone, suspended]) {
      expect({ target: target.login, login: (await me(await withClaim(target))).login }).toEqual({ target: target.login, login: 'shaked' })
    }
  })

  it('ignores a claim whose target_gh does not match the target row', async () => {
    expect((await me(await withClaim(alice, { targetGh: '999' }))).login).toBe('shaked')
  })

  it('ignores an expired claim', async () => {
    const old = Math.floor(Date.now() / 1000) - 3600
    expect((await me(await withClaim(alice, {}, old))).login).toBe('shaked')
  })

  it('ignores a claim without the view-as audience, and a session token used as a claim', async () => {
    const noAudience = await new SignJWT({ admin_uid: admin.id, admin_jti: adminJti, target_uid: alice.id, target_gh: '1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('5m')
      .sign(secretKey())
    expect((await me(`${adminCookie}; xt_view_as=${noAudience}`)).login).toBe('shaked')
    expect((await me(`${adminCookie}; xt_view_as=${adminCookie.split('=')[1]}`)).login).toBe('shaked')
  })
})

describe('read-only while viewing', () => {
  it('GET /drafts answers the target\'s drafts as counts under "Private draft", never text', async () => {
    const res = await call('GET', '/drafts?published=false', { cookie: await withClaim(alice) })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain(SECRET_TEXT)
    expect(text).not.toContain('Secret title')
    const drafts = JSON.parse(text).drafts
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({ id: draft.id, title: 'Private draft', post_count: 1 })
    expect(drafts[0].posts).toBeUndefined()
  })

  it('opening a draft and its export answers 403', async () => {
    const cookie = await withClaim(alice)
    for (const path of [`/drafts/${draft.id}`, `/drafts/${draft.id}/export`]) {
      const res = await call('GET', path, { cookie })
      expect({ path, status: res.status, error: (await res.json()).error }).toEqual({ path, status: 403, error: 'Viewing as cannot open drafts.' })
    }
  })

  // Routes that never call authenticate cannot act as the target, so they need no refusal. Each has its reason.
  const NEVER_AUTHENTICATE = [
    [(p) => p === '/threads/split', 'splits pasted text; no user, no data'],
    [(p) => p.startsWith('/auth/device/'), 'device codes; no session'],
    [(p) => p.startsWith('/oauth/'), 'OAuth endpoints read the real session only; authorize answers 409 (tested below)'],
    [(p) => p === '/auth/logout', 'reads the real session to end it'],
    [(p) => p === '/mcp', 'bearer tokens only; the cookie is ignored (tested below)'],
    [(p) => p.startsWith('/admin/'), 'the real admin (realSession), never the claim'],
    [(p) => p.startsWith('/ops/'), 'its own workflow token'],
    [(p) => p.startsWith('/share/'), 'public share links; no session'],
    [(p) => p.startsWith('/upload-links'), 'the one-time upload link token is the credential; no session']
  ]
  const exempt = (path) => NEVER_AUTHENTICATE.some(([test]) => test(path))

  it('lists the routes that never call authenticate by name', () => {
    const names = ROUTES.map((entry) => entry.path).filter(exempt).sort()
    expect(names).toEqual(
      [
        '/admin/audit', '/admin/flags', '/admin/flags', '/admin/metrics', '/admin/metrics/events', '/admin/metrics/series',
        '/admin/metrics/summary', '/admin/stats', '/admin/status', '/admin/users', '/admin/users/:id', '/admin/users/:id/delete',
        '/admin/users/:id/suspend', '/admin/users/:id/unsuspend', '/admin/view-as', '/admin/view-as', '/auth/device/poll', '/auth/device/start', '/auth/logout', '/mcp',
        '/oauth/authorize', '/oauth/authorize', '/oauth/logout', '/oauth/register', '/oauth/revoke', '/oauth/token',
        '/ops/events', '/ops/metrics-daily', '/share/:token', '/threads/split', '/upload-links', '/upload-links/images'
      ].sort()
    )
  })

  it('every other mutating route answers 403 to a viewing caller', async () => {
    const cookie = await withClaim(alice)
    const mutating = ROUTES.filter((entry) => entry.method !== 'GET' && entry.method !== 'HEAD' && !exempt(entry.path))
    expect(mutating.length).toBeGreaterThan(10)
    for (const entry of mutating) {
      const path = entry.path.replace(/:[A-Za-z]+/g, NIL)
      const res = await call(entry.method, path, { cookie, body: { text: 'x', position: 1, post_id: 'p1' } })
      const body = await res.json()
      expect({ route: `${entry.method} ${entry.path}`, status: res.status }).toEqual({ route: `${entry.method} ${entry.path}`, status: 403 })
      expect(body.error).toMatch(/^Viewing as alice: /)
    }
    // Nothing changed.
    const { rows } = await db.pg.query('select count(*)::int as n from drafts where user_id = $1', [alice.id])
    expect(rows[0].n).toBe(1)
  })

  it('credential routes answer 403', async () => {
    const cookie = await withClaim(alice)
    for (const path of ['/tokens', '/grants']) {
      expect((await call('GET', path, { cookie })).status).toBe(403)
    }
    expect((await call('POST', '/tokens', { cookie, body: { name: 'x' } })).status).toBe(403)
    // Without the claim the admin still lists their own tokens.
    expect((await call('GET', '/tokens', { cookie: adminCookie })).status).toBe(200)
  })
})

describe('where the claim never applies', () => {
  it('a bearer token with the cookie: the cookie is ignored', async () => {
    const user = await me(await withClaim(alice), { authorization: `Bearer ${xtToken}` })
    expect(user.login).toBe('shaked')
  })

  it('POST /mcp with the cookie: the cookie is not a credential', async () => {
    const res = await route(
      new Request('https://app.test/api/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: await withClaim(alice), accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      })
    )
    expect(res.status).toBe(401)
  })

  it('readSession never accepts the claim, and returns the admin when both cookies are present', async () => {
    const claim = await claimFor(alice)
    expect(await readSession(apiRequest('/api/x', { cookie: `xt_session=${claim}` }))).toBeNull()
    const session = await readSession(apiRequest('/api/x', { cookie: await withClaim(alice) }))
    expect(session.uid).toBe(admin.id)
  })

  it('an admin route with the claim still answers as the admin', async () => {
    const res = await call('GET', '/admin/status', { cookie: await withClaim(alice), headers: { 'x-xt-admin': '1' } })
    expect(res.status).toBe(200)
  })

  it('OAuth authorize with the claim answers 409, GET and POST', async () => {
    const cookie = await withClaim(alice)
    const get = await call('GET', '/oauth/authorize?client_id=x', { cookie })
    expect(get.status).toBe(409)
    expect(await get.text()).toContain('End viewing as alice before connecting an app.')
    const post = await call('POST', '/oauth/authorize', { cookie, body: 'decision=approve', headers: { 'content-type': 'application/x-www-form-urlencoded' } })
    expect(post.status).toBe(409)
  })

  it('logout clears both cookies', async () => {
    const res = await call('POST', '/auth/logout', { cookie: await withClaim(alice) })
    expect(res.status).toBe(200)
    const cookies = res.headers.getSetCookie()
    expect(cookies.find((c) => c.startsWith('xt_session='))).toMatch(/Max-Age=0/)
    expect(cookies.find((c) => c.startsWith('xt_view_as='))).toMatch(/Max-Age=0/)
    expect(clearViewAsCookie()).toMatch(/SameSite=Strict/)
  })
})
