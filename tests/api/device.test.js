// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({ putBlob: vi.fn(), deleteBlobUrls: vi.fn(async () => {}) }))

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

  it('poll returns 201 with a token once approved, and stores no GitHub token', async () => {
    mockGithub({ access_token: 'gho_secret_from_github', token_type: 'bearer' })
    const res = await route(
      apiRequest('/api/auth/device/poll', { method: 'POST', body: { device_code: 'device-123', name: 'claude' } })
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.token).toMatch(/^xt_/)
    expect(body.user).toMatchObject({ login: 'octo' })

    const rows = await db.pg.query('select token_prefix, created_via from api_tokens')
    expect(rows.rows[0]).toEqual({ token_prefix: body.token.slice(0, 10), created_via: 'device' })
    expect(JSON.stringify(await db.pg.query('select * from users'))).not.toContain('gho_secret_from_github')
    expect(JSON.stringify(await db.pg.query('select * from api_tokens'))).not.toContain('gho_secret_from_github')
  })

  it('poll rejects a request without a device code', async () => {
    const res = await route(apiRequest('/api/auth/device/poll', { method: 'POST', body: {} }))
    expect(res.status).toBe(400)
  })
})
