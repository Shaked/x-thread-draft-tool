// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildInfo } from '../../scripts/build-info.mjs'

const now = new Date('2026-11-17T14:02:03.000Z')
const migrations = ['001_init.sql', '008_revoked_sessions.sql', '007_share_expiry.sql', 'notes.txt']

describe('buildInfo', () => {
  it('prefers the Vercel sha over git, uses the newest migration and the build time', () => {
    const info = buildInfo({ env: { VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40) }, now, gitHead: 'b'.repeat(40), migrations })
    expect(info).toEqual({ commit: 'a'.repeat(40), deployed_at: '2026-11-17T14:02:03.000Z', schema: '008_revoked_sessions' })
  })

  it('falls back to the git head', () => {
    expect(buildInfo({ env: {}, now, gitHead: 'c'.repeat(40), migrations }).commit).toBe('c'.repeat(40))
  })

  it('gives nulls when nothing is known and has no other keys', () => {
    const info = buildInfo({ now })
    expect(info).toEqual({ commit: null, deployed_at: '2026-11-17T14:02:03.000Z', schema: null })
  })
})
