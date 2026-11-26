// Observability plan O3 (#334): the MCP client app family, a fixed list. The raw client_id is never in the result.
import { describe, expect, it } from 'vitest'
import { clientFamily, MCP_FAMILIES } from '../../server/metrics/client-family.js'

describe('clientFamily', () => {
  it('maps a registered client by the https host of its redirect URI', () => {
    expect(clientFamily({ kind: 'registered', client_id: 'xtc_a', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] })).toBe('mcp:claude')
    expect(clientFamily({ kind: 'registered', client_id: 'xtc_b', redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'] })).toBe('mcp:chatgpt')
  })

  it('maps a metadata client by the host of its client_id URL', () => {
    expect(clientFamily({ kind: 'metadata', client_id: 'https://claude.ai/oauth/claude-code-client-metadata', redirect_uris: [] })).toBe('mcp:claude')
  })

  it('maps a device client to the command line, whatever its name', () => {
    expect(clientFamily({ kind: 'device', client_id: 'device:Claude agent', redirect_uris: [] })).toBe('mcp:cli')
  })

  it('maps a look-alike host to mcp:other', () => {
    expect(clientFamily({ kind: 'registered', client_id: 'xtc_c', redirect_uris: ['https://claude.ai.evil.example/cb'] })).toBe('mcp:other')
    expect(clientFamily({ kind: 'metadata', client_id: 'https://chatgpt.com.evil.example/meta', redirect_uris: [] })).toBe('mcp:other')
  })

  it('maps a localhost redirect, an http URL and a missing client to mcp:other', () => {
    expect(clientFamily({ kind: 'registered', client_id: 'xtc_d', redirect_uris: ['http://127.0.0.1:1455/callback'] })).toBe('mcp:other')
    expect(clientFamily({ kind: 'registered', client_id: 'xtc_e', redirect_uris: ['http://claude.ai/cb'] })).toBe('mcp:other')
    expect(clientFamily(undefined)).toBe('mcp:other')
  })

  it('returns only a value from the fixed list', () => {
    expect(MCP_FAMILIES).toEqual(['mcp:claude', 'mcp:chatgpt', 'mcp:grok', 'mcp:cli', 'mcp:other'])
    const result = clientFamily({ kind: 'registered', client_id: 'xtc_secret_value', redirect_uris: [] })
    expect(MCP_FAMILIES).toContain(result)
    expect(result).not.toContain('xtc_secret_value')
  })
})
