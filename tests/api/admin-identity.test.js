// @vitest-environment node
import { describe, expect, it } from 'vitest'
import * as identity from '../../server/admin/identity.js'

const { isAdminGithubId, isProtectedGithubId, protectedGithubIds } = identity

describe('admin identity (plan A2)', () => {
  it('pins the only admin id to github.com/Shaked (960015)', () => {
    expect(isAdminGithubId('960015')).toBe(true)
    expect(isAdminGithubId(960015)).toBe(true)
    expect(isAdminGithubId(960015n)).toBe(true)
  })

  it('refuses every other id, login and near miss', () => {
    for (const id of ['9600150', '-1', '0', '', null, undefined, 'Shaked']) {
      expect(isAdminGithubId(id)).toBe(false)
    }
  })

  it('ADMIN_DISABLED=1 turns admin off and nothing else can turn it on', () => {
    expect(isAdminGithubId('960015', { ADMIN_DISABLED: '1' })).toBe(false)
    for (const env of [{ ADMIN_GITHUB_IDS: '5' }, { ADMIN_IDS: '5' }, { ADMIN_DISABLED: '0' }, {}]) {
      expect(isAdminGithubId('5', env)).toBe(false)
    }
  })

  it('protects exactly the admin and the CI identity, and cannot be switched off', () => {
    expect(protectedGithubIds()).toEqual(['960015', '-1'])
    expect(isProtectedGithubId('960015')).toBe(true)
    expect(isProtectedGithubId('-1')).toBe(true)
    expect(isProtectedGithubId('1')).toBe(false)
    const previous = process.env.ADMIN_DISABLED
    process.env.ADMIN_DISABLED = '1'
    try {
      expect(isProtectedGithubId('960015')).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.ADMIN_DISABLED
      else process.env.ADMIN_DISABLED = previous
    }
  })

  it('exports exactly the three functions and the elevation hours', () => {
    expect(Object.keys(identity).sort()).toEqual(['ADMIN_ELEVATION_HOURS', 'isAdminGithubId', 'isProtectedGithubId', 'protectedGithubIds'])
  })
})
