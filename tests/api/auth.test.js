// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignJWT, decodeJwt } from 'jose'
import { route } from '../../server/router.js'
import { secretKey } from '../../server/session.js'
import { apiRequest, setupTestDb } from './helpers/db.js'

let db

beforeAll(async () => {
  db = await setupTestDb()
})

beforeEach(async () => {
  await db.reset()
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function mockGithub({ token = 'gho_test_token', user = { id: 4242, login: 'octo', name: 'Octo Cat', avatar_url: 'https://avatars.test/octo.png' } } = {}) {
  globalThis.fetch.mockImplementation(async (input) => {
    const url = String(input)
    if (url === 'https://github.com/login/oauth/access_token') return Response.json({ access_token: token })
    if (url === 'https://api.github.com/user') return Response.json(user)
    throw new Error(`unexpected fetch ${url}`)
  })
}

async function signIn(state = 'state-123') {
  return route(
    apiRequest(`/api/auth/callback?code=the-code&state=${state}`, {
      cookie: `xt_oauth_state=${state}`
    })
  )
}

describe('GET /api/auth/login', () => {
  it('redirects a request for another host to the canonical origin, with no state cookie', async () => {
    const res = await route(apiRequest('/api/auth/login', { headers: { 'x-forwarded-host': 'x-thread-draft-tool-git-x.vercel.app' } }))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://app.test/api/auth/login')
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('redirects when the request URL itself is another host', async () => {
    const other = new Request('https://other.test/api/auth/login')
    const res = await route(other)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://app.test/api/auth/login')
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('redirects to GitHub with a state value and sets the state cookie', async () => {
    const res = await route(apiRequest('/api/auth/login'))

    expect(res.status).toBe(302)
    const location = new URL(res.headers.get('location'))
    expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(location.searchParams.get('client_id')).toBe('test-client-id')
    expect(location.searchParams.get('redirect_uri')).toBe('https://app.test/api/auth/callback')
    expect(location.searchParams.get('scope')).toBe('read:user')
    expect(location.searchParams.get('state')).toMatch(/^[0-9a-f-]{36}$/)

    const cookie = res.headers.get('set-cookie')
    expect(cookie).toContain(`xt_oauth_state=${location.searchParams.get('state')}`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
  })
})

describe('GET /api/auth/callback', () => {
  it('rejects a callback whose state does not match the cookie', async () => {
    const res = await route(
      apiRequest('/api/auth/callback?code=the-code&state=attacker', { cookie: 'xt_oauth_state=expected' })
    )
    expect(res.status).toBe(400)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('rejects a callback with no state cookie at all', async () => {
    const res = await route(apiRequest('/api/auth/callback?code=the-code&state=abc'))
    expect(res.status).toBe(400)
  })

  it('upserts the user, sets the session cookie, clears the state cookie, and never stores the GitHub token', async () => {
    mockGithub()
    const res = await signIn()

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://app.test/')
    const cookies = res.headers.getSetCookie()
    expect(cookies.some((c) => c.startsWith('xt_session=') && c.includes('HttpOnly'))).toBe(true)
    expect(cookies.some((c) => c.startsWith('xt_oauth_state=') && c.includes('Max-Age=0'))).toBe(true)

    const { rows } = await db.pg.query('select github_id, login, name, avatar_url from users')
    expect(rows).toEqual([
      { github_id: 4242, login: 'octo', name: 'Octo Cat', avatar_url: 'https://avatars.test/octo.png' }
    ])

    const columns = await db.pg.query(
      "select column_name from information_schema.columns where table_name = 'users'"
    )
    expect(columns.rows.map((r) => r.column_name)).not.toContain('access_token')
    expect(JSON.stringify(await db.pg.query('select * from users'))).not.toContain('gho_test_token')
  })

  it('reuses the same users.id when the same GitHub account signs in again', async () => {
    mockGithub()
    await signIn('s1')
    const first = (await db.pg.query('select id from users')).rows[0].id

    mockGithub({ user: { id: 4242, login: 'octo-renamed', name: 'Octo', avatar_url: null } })
    await signIn('s2')

    const rows = (await db.pg.query('select id, login from users')).rows
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(first)
    expect(rows[0].login).toBe('octo-renamed')
  })

  it('reports a GitHub failure as 502', async () => {
    globalThis.fetch.mockResolvedValue(Response.json({ error: 'bad_verification_code' }, { status: 200 }))
    const res = await signIn()
    expect(res.status).toBe(502)
  })
})

describe('GET /api/auth/me and POST /api/auth/logout', () => {
  it('returns the user when the session cookie is valid', async () => {
    const user = await db.insertUser({ github_id: 7, login: 'bob', name: 'Bob', avatar_url: null })
    const cookie = await db.cookieFor(user)

    const res = await route(apiRequest('/api/auth/me', { cookie }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      user: { id: user.id, login: 'bob', name: 'Bob', avatar_url: null },
      auth: 'session'
    })
  })

  it('returns user null without a cookie, with a forged cookie, and for a deleted account', async () => {
    const noCookie = await route(apiRequest('/api/auth/me'))
    expect(noCookie.status).toBe(200)
    expect(await noCookie.json()).toEqual({ user: null, auth: null })

    const forged = await route(apiRequest('/api/auth/me', { cookie: 'xt_session=not.a.jwt' }))
    expect(await forged.json()).toEqual({ user: null, auth: null })

    const user = await db.insertUser({ github_id: 8, login: 'gone' })
    const cookie = await db.cookieFor(user)
    await db.pg.query('delete from users where id = $1', [user.id])
    const deleted = await route(apiRequest('/api/auth/me', { cookie }))
    expect(await deleted.json()).toEqual({ user: null, auth: null })
  })

  it('logout clears the session cookie', async () => {
    const res = await route(apiRequest('/api/auth/logout', { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(res.headers.get('set-cookie')).toMatch(/^xt_session=;.*Max-Age=0/)
  })

  it('logout ends the session on the server: the old cookie value gets 401, a second logout still answers 200', async () => {
    const user = await db.insertUser({ github_id: 9, login: 'carol' })
    const cookie = await db.cookieFor(user)
    expect((await route(apiRequest('/api/drafts?published=false', { cookie }))).status).toBe(200)

    const res = await route(apiRequest('/api/auth/logout', { method: 'POST', cookie }))
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toMatch(/^xt_session=;.*Max-Age=0/)

    expect((await route(apiRequest('/api/drafts?published=false', { cookie }))).status).toBe(401)
    expect(await (await route(apiRequest('/api/auth/me', { cookie }))).json()).toEqual({ user: null, auth: null })
    expect((await route(apiRequest('/api/auth/logout', { method: 'POST', cookie }))).status).toBe(200)
    // Signing out twice leaves exactly one row for this session.
    const { jti } = decodeJwt(cookie.slice('xt_session='.length))
    expect((await db.pg.query('select 1 from revoked_sessions where jti = $1', [jti])).rows).toHaveLength(1)
  })

  it('revokes only the session that signed out: another session of the same user keeps working', async () => {
    const user = await db.insertUser({ github_id: 10, login: 'dave' })
    const first = await db.cookieFor(user)
    const second = await db.cookieFor(user)
    await route(apiRequest('/api/auth/logout', { method: 'POST', cookie: first }))
    expect((await route(apiRequest('/api/drafts?published=false', { cookie: first }))).status).toBe(401)
    expect((await route(apiRequest('/api/drafts?published=false', { cookie: second }))).status).toBe(200)
  })

  it('refuses a validly signed session token that has no jti', async () => {
    const user = await db.insertUser({ github_id: 11, login: 'erin' })
    const token = await new SignJWT({ uid: user.id, gh: String(user.github_id), login: user.login })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secretKey())
    expect((await route(apiRequest('/api/drafts?published=false', { cookie: `xt_session=${token}` }))).status).toBe(401)
  })

  it('refuses a token whose jti is revoked and accepts one with an unrelated jti', async () => {
    const user = await db.insertUser({ github_id: 12, login: 'frank' })
    const sign = (jti) =>
      new SignJWT({ uid: user.id, gh: String(user.github_id), login: user.login, jti })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(secretKey())
    await db.pg.query("insert into revoked_sessions (jti, expires_at) values ('revoked-one', now() + interval '1 hour')")
    expect((await route(apiRequest('/api/drafts?published=false', { cookie: `xt_session=${await sign('revoked-one')}` }))).status).toBe(401)
    expect((await route(apiRequest('/api/drafts?published=false', { cookie: `xt_session=${await sign('another-one')}` }))).status).toBe(200)
  })

  it('sign-out removes revoked rows whose time has passed', async () => {
    const user = await db.insertUser({ github_id: 13, login: 'gina' })
    await db.pg.query("insert into revoked_sessions (jti, expires_at) values ('old-one', now() - interval '1 day')")
    await route(apiRequest('/api/auth/logout', { method: 'POST', cookie: await db.cookieFor(user) }))
    const { rows } = await db.pg.query("select jti from revoked_sessions where jti = 'old-one'")
    expect(rows).toHaveLength(0)
  })

  it('a bearer token on logout revokes nothing', async () => {
    const before = (await db.pg.query('select jti from revoked_sessions')).rows.length
    const res = await route(apiRequest('/api/auth/logout', { method: 'POST', headers: { authorization: 'Bearer xt_x' } }))
    expect(res.status).toBe(200)
    expect((await db.pg.query('select jti from revoked_sessions')).rows).toHaveLength(before)
  })
})
