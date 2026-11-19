// @vitest-environment node
import { describe, expect, it } from 'vitest'
import * as identity from '../../server/admin/identity.js'

const { isAdminGithubId, isAdminRedirectUri, isProtectedGithubId, protectedGithubIds } = identity

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

  it('accepts exactly the two real Claude and ChatGPT return addresses for admin', () => {
    expect(isAdminRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true)
    expect(isAdminRedirectUri('https://chatgpt.com/connector_platform_oauth_redirect')).toBe(true)
    for (const uri of [
      'https://claude.ai/api/mcp/auth_callback?x=1',
      'https://claude.ai/api/mcp/auth_callback/',
      'https://claude.ai/api/mcp/auth_callback/extra',
      'http://claude.ai/api/mcp/auth_callback',
      'https://claude.ai.evil.example/api/mcp/auth_callback',
      'http://localhost/callback',
      'http://127.0.0.1:1455/callback',
      'https://evil.example/cb',
      null,
      undefined,
      ''
    ]) {
      expect(isAdminRedirectUri(uri)).toBe(false)
    }
  })

  it('exports exactly the four functions', () => {
    expect(Object.keys(identity).sort()).toEqual([
      'isAdminGithubId',
      'isAdminRedirectUri',
      'isProtectedGithubId',
      'protectedGithubIds'
    ])
  })
})
