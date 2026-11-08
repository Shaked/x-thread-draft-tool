// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({ putBlob: vi.fn(), deleteBlobUrls: vi.fn(async () => {}) }))

import { route } from '../../server/router.js'
import { APP_URL, apiRequest, setupTestDb } from './helpers/db.js'

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

/** Routes fake GitHub responses by URL; `poll` decides the device-token answer. */
function mockGithub(poll) {
  globalThis.fetch.mockImplementation(async (input) => {
    const url = String(input)
    if (url === 'https://github.com/login/device/code') {
      return Response.json({
        device_code: 'device-123',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        interval: 5,
        expires_in: 900
      })
    }
    if (url === 'https://github.com/login/oauth/access_token') return Response.json(poll)
    if (url === 'https://api.github.com/user') {
      return Response.json({ id: 555, login: 'octo', name: 'Octo', avatar_url: null })
    }
    throw new Error(`unexpected fetch ${url}`)
  })
}

/** Polls once after approval and returns the 201 body; `name` is the device name. */
async function pollFor(name) {
  const res = await route(apiRequest('/api/auth/device/poll', { method: 'POST', body: { device_code: 'device-123', name } }))
  expect(res.status).toBe(201)
  return res.json()
}

/** Refreshes through the token endpoint, as the scripts do (form body, no cookie, no Origin). */
function refresh(refreshToken, clientId) {
  return route(
    apiRequest('/api/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId }).toString()
    })
  )
}

describe('device flow', () => {
  it('start returns the code the human types and the poll interval', async () => {
    mockGithub({})
    const res = await route(apiRequest('/api/auth/device/start', { method: 'POST', body: {} }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ user_code: 'ABCD-1234', interval: 5, device_code: 'device-123' })
  })

  it('poll returns 202 while the human has not approved yet', async () => {
    mockGithub({ error: 'authorization_pending' })
    const res = await route(apiRequest('/api/auth/device/poll', { method: 'POST', body: { device_code: 'device-123' } }))
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ status: 'pending', interval: 5 })
  })

  it('poll returns 400 when the human denies the request', async () => {
    mockGithub({ error: 'access_denied' })
    const res = await route(apiRequest('/api/auth/device/poll', { method: 'POST', body: { device_code: 'device-123' } }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('access_denied')
  })

  it('poll returns 201 with an access and refresh pair once approved, and stores no GitHub token', async () => {
    mockGithub({ access_token: 'gho_secret_from_github', token_type: 'bearer' })
    const body = await pollFor('claude')
    expect(body).toMatchObject({
      access_token: expect.stringMatching(/^xta_[A-Za-z0-9_-]{43}$/),
      refresh_token: expect.stringMatching(/^xtr_[A-Za-z0-9_-]{43}$/),
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'drafts',
      client_id: 'device:claude',
      token: body.access_token,
      user: { login: 'octo' }
    })

    const grants = await db.pg.query('select client_id, resource, revoked_at from oauth_grants')
    expect(grants.rows).toEqual([{ client_id: 'device:claude', resource: `${APP_URL}/api`, revoked_at: null }])
    const clients = await db.pg.query("select kind, client_name from oauth_clients where client_id = 'device:claude'")
    expect(clients.rows).toEqual([{ kind: 'device', client_name: 'claude' }])
    expect((await db.pg.query('select count(*)::int as n from api_tokens')).rows[0].n).toBe(0)
    expect(JSON.stringify(await db.pg.query('select * from users'))).not.toContain('gho_secret_from_github')
    expect(JSON.stringify(await db.pg.query('select * from oauth_tokens'))).not.toContain('gho_secret_from_github')
  })

  it('the access token works on the REST API', async () => {
    mockGithub({ access_token: 'gho_x' })
    const { access_token: access } = await pollFor('claude')
    const res = await route(apiRequest('/api/drafts?published=false', { headers: { authorization: `Bearer ${access}` } }))
    expect(res.status).toBe(200)
  })

  it('the access token is refused on /api/mcp, because the grant is bound to the REST resource', async () => {
    mockGithub({ access_token: 'gho_x' })
    const { access_token: access } = await pollFor('claude')
    const res = await route(
      apiRequest('/api/mcp', {
        method: 'POST',
        headers: { authorization: `Bearer ${access}`, 'mcp-protocol-version': '2025-06-18' },
        body: { jsonrpc: '2.0', id: 1, method: 'tools/list' }
      })
    )
    expect(res.status).toBe(401)
  })

  it('refresh rotates the pair: the new access token works, the old refresh token is spent', async () => {
    mockGithub({ access_token: 'gho_x' })
    const first = await pollFor('claude')
    const second = await refresh(first.refresh_token, 'device:claude')
    expect(second.status).toBe(200)
    const pair = await second.json()
    expect(pair.access_token).not.toBe(first.access_token)
    expect(pair.refresh_token).not.toBe(first.refresh_token)
    expect(pair).toMatchObject({ expires_in: 3600, token_type: 'Bearer' })

    const drafts = await route(apiRequest('/api/drafts?published=false', { headers: { authorization: `Bearer ${pair.access_token}` } }))
    expect(drafts.status).toBe(200)

    // Reusing the spent refresh token is refused and revokes the grant (reuse detection).
    const reused = await refresh(first.refresh_token, 'device:claude')
    expect(reused.status).toBe(400)
    expect((await reused.json()).error).toBe('invalid_grant')
    const after = await route(apiRequest('/api/drafts?published=false', { headers: { authorization: `Bearer ${pair.access_token}` } }))
    expect(after.status).toBe(401)
  })

  it('a refresh for another client is refused', async () => {
    mockGithub({ access_token: 'gho_x' })
    const { refresh_token: refreshToken } = await pollFor('claude')
    const res = await refresh(refreshToken, 'device:other')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_grant')
  })

  it('signing in again with the same name reuses the grant', async () => {
    mockGithub({ access_token: 'gho_x' })
    await pollFor('claude')
    await pollFor('claude')
    expect((await db.pg.query('select count(*)::int as n from oauth_grants')).rows[0].n).toBe(1)
  })

  it('signing in again after the grant was revoked issues a working pair and keeps the old tokens dead', async () => {
    mockGithub({ access_token: 'gho_x' })
    const old = await pollFor('claude')
    await db.pg.query('update oauth_grants set revoked_at = now()')
    const fresh = await pollFor('claude')
    const oldDrafts = await route(apiRequest('/api/drafts?published=false', { headers: { authorization: `Bearer ${old.access_token}` } }))
    expect(oldDrafts.status).toBe(401)
    const newDrafts = await route(apiRequest('/api/drafts?published=false', { headers: { authorization: `Bearer ${fresh.access_token}` } }))
    expect(newDrafts.status).toBe(200)
  })

  it('a device name longer than 100 characters is refused', async () => {
    mockGithub({ access_token: 'gho_x' })
    const res = await route(
      apiRequest('/api/auth/device/poll', { method: 'POST', body: { device_code: 'device-123', name: 'x'.repeat(101) } })
    )
    expect(res.status).toBe(400)
  })

  it('poll rejects a request without a device code', async () => {
    const res = await route(apiRequest('/api/auth/device/poll', { method: 'POST', body: {} }))
    expect(res.status).toBe(400)
  })
})
