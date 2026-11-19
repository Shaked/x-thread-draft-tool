// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { formatVersion, utcText } from '../../src/utils/version'

const info = { commit: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', deployed_at: '2026-11-15T07:46:19Z' }

describe('formatVersion', () => {
  it('reads unknown for a missing build info', () => {
    expect(formatVersion(null, new Date('2026-11-18T07:46:19Z'))).toEqual({
      short: 'unknown',
      deployedAt: 'unknown',
      ago: 'unknown'
    })
    expect(utcText(undefined)).toBe('unknown')
  })

  it('shows the 7-character commit and seconds ago', () => {
    const now = new Date('2026-11-15T07:46:49Z')
    const version = formatVersion(info, now)
    expect(version.short).toBe('a1b2c3d')
    expect(version.ago).toBe('30 seconds ago')
    expect(version.deployedAt).not.toBe('unknown')
  })

  it('shows whole days ago', () => {
    const now = new Date('2026-11-18T07:46:19Z')
    expect(formatVersion(info, now).ago).toBe('3 days ago')
  })

  it('reads unknown for an invalid deploy time and never a negative age', () => {
    expect(formatVersion({ commit: null, deployed_at: 'not a date' }, new Date()).deployedAt).toBe('unknown')
    expect(formatVersion(info, new Date('2026-11-15T07:46:00Z')).ago).toBe('now')
  })

  it('formats the UTC time for a title', () => {
    expect(utcText('2026-11-15T07:46:19Z')).toBe('2026-11-15 07:46:19 UTC')
  })
})
