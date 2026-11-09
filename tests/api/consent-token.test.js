// @vitest-environment node
// Plan 7.5 review fix: a consent token built from maximum-length accepted fields must open again.
import { beforeAll, describe, expect, it } from 'vitest'
import { openDecision, sealDecision } from '../../server/oauth/consent.js'

describe('consent decision token size', () => {
  beforeAll(() => {
    process.env.SESSION_SECRET = 'test-session-secret-0123456789-abcdefghijklmnop'
    process.env.PUBLIC_APP_URL = 'https://app.test'
  })

  it('opens a token built from four maximum-length accepted fields', async () => {
    const long = 'a'.repeat(2048)
    const token = await sealDecision({ client_id: long, redirect_uri: long, resource: long, state: long, uid: 'u1' })
    expect(token.length).toBeGreaterThan(4096)
    const payload = await openDecision(token)
    expect(payload?.client_id).toBe(long)
    expect(payload?.uid).toBe('u1')
  })

  it('still refuses an oversized token', async () => {
    expect(await openDecision('x'.repeat(16385))).toBeNull()
  })
})
