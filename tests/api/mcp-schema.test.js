// @vitest-environment node
// Plan M13: official-schema conformance. Today's /api/mcp results are validated against the MCP
// JSON Schemas vendored in tests/api/fixtures/mcp-schema/ (2026-07-28 and 2025-11-25), taken from
// github.com/modelcontextprotocol/modelcontextprotocol, schema/<version>/schema.json, at main
// commit 0175d20f8b2c49e0402c37c37ed39ae2be47277e. The files have no $id, so each is registered
// under its own key. No network in tests; strict mode is off for the spec files only.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({ putBlob: vi.fn(), deleteBlobUrls: vi.fn(async () => {}) }))

import { route } from '../../server/router.js'
import { issuePair } from '../../server/oauth/tokens.js'
import { APP_URL, setupTestDb } from './helpers/db.js'
import { expectValid } from './helpers/mcp-schema.js'

const MCP = `${APP_URL}/api/mcp`
const MODERN = '2026-07-28'
const LEGACY = '2025-11-25'

let db
let alice
let bob

beforeAll(async () => {
  db = await setupTestDb()
})

beforeEach(async () => {
  await db.reset()
  await db.pg.query(
    "insert into oauth_clients (client_id, kind, client_name) values ('xtc_mcp_test', 'registered', 'Test') on conflict do nothing"
  )
  alice = await db.insertUser({ github_id: 1, login: 'alice' })
  bob = await db.insertUser({ github_id: 2, login: 'bob' })
})

async function accessToken(user) {
  const { rows } = await db.pg.query(
    "insert into oauth_grants (user_id, client_id, scope, resource) values ($1, 'xtc_mcp_test', 'drafts', $2) returning id",
    [user.id, MCP]
  )
  return (await issuePair(rows[0].id)).access_token
}

function modernPost(method, params, token) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': MODERN,
    'mcp-method': method,
    authorization: `Bearer ${token}`
  }
  if (method === 'tools/call') headers['mcp-name'] = params.name
  const body = { jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN } } }
  return new Request(MCP, { method: 'POST', headers, body: JSON.stringify(body) })
}

function legacyPost(method, params, token) {
  return new Request(MCP, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  })
}

async function json(request) {
  const res = await route(request)
  return JSON.parse(await res.text())
}

describe('2026-07-28 schema', () => {
  it('server/discover is a DiscoverResult', async () => {
    const token = await accessToken(alice)
    expectValid(MODERN, 'DiscoverResult', (await json(modernPost('server/discover', {}, token))).result)
  })

  it('tools/list is a ListToolsResult', async () => {
    const token = await accessToken(alice)
    expectValid(MODERN, 'ListToolsResult', (await json(modernPost('tools/list', {}, token))).result)
  })

  it('tools/call results are CallToolResults, success and isError', async () => {
    const token = await accessToken(alice)
    const bobDraft = await db.insertDraft(bob.id, { title: 'Bob private' })
    for (const [name, args] of [['whoami', {}], ['list_drafts', {}], ['get_draft', { id: bobDraft.id }]]) {
      const { result } = await json(modernPost('tools/call', { name, arguments: args }, token))
      if (name === 'get_draft') expect(result.isError).toBe(true)
      expectValid(MODERN, 'CallToolResult', result)
    }
  })

  it('errors are JSONRPCErrorResponses (unknown method, bad params)', async () => {
    const token = await accessToken(alice)
    expectValid(MODERN, 'JSONRPCErrorResponse', await json(modernPost('no/such', {}, token)))
    const bad = await json(modernPost('tools/call', { name: 'no_such_tool', arguments: {} }, token))
    expect(bad.error).toBeTruthy()
    expectValid(MODERN, 'JSONRPCErrorResponse', bad)
  })
})

describe('2025-11-25 schema', () => {
  it('initialize is an InitializeResult', async () => {
    const token = await accessToken(alice)
    const body = await json(legacyPost('initialize', { protocolVersion: LEGACY, capabilities: {}, clientInfo: { name: 't', version: '1' } }, token))
    expect(body.result.protocolVersion).toBe(LEGACY)
    expectValid(LEGACY, 'InitializeResult', body.result)
  })

  it('tools/list is a ListToolsResult', async () => {
    const token = await accessToken(alice)
    expectValid(LEGACY, 'ListToolsResult', (await json(legacyPost('tools/list', {}, token))).result)
  })

  it('tools/call results are CallToolResults, success and isError', async () => {
    const token = await accessToken(alice)
    const bobDraft = await db.insertDraft(bob.id, { title: 'Bob private' })
    for (const [name, args] of [['whoami', {}], ['list_drafts', {}], ['get_draft', { id: bobDraft.id }]]) {
      const { result } = await json(legacyPost('tools/call', { name, arguments: args }, token))
      if (name === 'get_draft') expect(result.isError).toBe(true)
      expectValid(LEGACY, 'CallToolResult', result)
    }
  })

  it('errors are JSONRPCErrorResponses', async () => {
    const token = await accessToken(alice)
    expectValid(LEGACY, 'JSONRPCErrorResponse', await json(legacyPost('no/such', {}, token)))
  })
})
