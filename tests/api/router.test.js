// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { route } from '../../server/router.js'
import { apiRequest, setupTestDb } from './helpers/db.js'

beforeAll(async () => {
  await setupTestDb()
})

describe('router', () => {
  it('answers the health check without touching the database', async () => {
    const res = await route(apiRequest('/api/health'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('accepts the Vercel rewrite form with __path', async () => {
    const res = await route(apiRequest('/api/handler?__path=health'))
    expect(await res.json()).toEqual({ ok: true })
  })

  it('returns 404 JSON for an unknown path', async () => {
    const res = await route(apiRequest('/api/unknown'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
  })

  it('returns 405 when the path exists but the method does not', async () => {
    const res = await route(apiRequest('/api/drafts', { method: 'PUT' }))
    expect(res.status).toBe(405)
  })

  it('blocks state-changing requests from a foreign origin with 403', async () => {
    const res = await route(
      apiRequest('/api/auth/logout', { method: 'POST', origin: 'https://evil.example' })
    )
    expect(res.status).toBe(403)
  })

  it('allows state-changing requests from the app origin', async () => {
    const res = await route(apiRequest('/api/auth/logout', { method: 'POST', origin: 'https://app.test' }))
    expect(res.status).toBe(200)
  })
})
