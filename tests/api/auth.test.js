// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { route } from '../../server/router.js'
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
})
