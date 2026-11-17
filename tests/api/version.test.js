// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { route } from '../../server/router.js'
import { getVersion } from '../../server/version.js'
import { apiRequest, setupTestDb } from './helpers/db.js'

beforeAll(async () => {
  await setupTestDb()
})

const KEYS = ['commit', 'commit_short', 'deployed_at', 'environment', 'schema']

describe('GET /api/version', () => {
  it('is public, cacheable for a minute and has exactly five keys', async () => {
    const res = await route(apiRequest('/api/version'))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=60')
    const body = await res.json()
    expect(Object.keys(body).sort()).toEqual(KEYS)
    if (body.commit_short !== null) expect(body.commit_short).toHaveLength(7)
    expect(JSON.stringify(body)).not.toMatch(/token|secret|key|:\/\//i)
  })

  it('is listed in the OpenAPI document', async () => {
    const doc = await (await route(apiRequest('/api/openapi.json'))).json()
    expect(doc.paths['/version'].get).toBeDefined()
  })
})

describe('getVersion', () => {
  const generated = { commit: 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0', deployed_at: '2026-11-17T14:02:03.000Z', schema: '008_revoked_sessions' }

  it('reads the generated file', async () => {
    const info = await getVersion({ load: async () => generated, env: { VERCEL_ENV: 'production' } })
    expect(info).toEqual({ ...generated, commit_short: 'a1b2c3d', environment: 'production' })
  })

  it('works without the generated file: env sha, deployed_at null', async () => {
    const info = await getVersion({ load: async () => null, env: { VERCEL_GIT_COMMIT_SHA: 'f'.repeat(40) } })
    expect(info).toEqual({ commit: 'f'.repeat(40), commit_short: 'fffffff', deployed_at: null, environment: 'local', schema: null })
  })

  it('works with nothing at all', async () => {
    const info = await getVersion({ load: async () => null, env: {} })
    expect(info).toEqual({ commit: null, commit_short: null, deployed_at: null, environment: 'local', schema: null })
  })

  it('the default loader survives a missing generated file', async () => {
    const info = await getVersion({ env: {} })
    expect(Object.keys(info).sort()).toEqual(KEYS)
  })
})
