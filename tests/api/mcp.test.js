// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({ putBlob: vi.fn(), deleteBlobUrls: vi.fn(async () => {}) }))

import { route } from '../../server/router.js'
import { issuePair } from '../../server/oauth/tokens.js'
import { APP_URL, setupTestDb } from './helpers/db.js'

const MCP = `${APP_URL}/api/mcp`
const WWW_AUTHENTICATE = `Bearer resource_metadata="${APP_URL}/.well-known/oauth-protected-resource/api/mcp", scope="drafts"`
const MODERN = '2026-07-28'
const TOOL_NAMES = [
  'list_drafts', 'get_draft', 'create_draft', 'update_draft', 'duplicate_draft', 'export_draft',
  'split_text', 'create_share_link', 'add_image_from_url', 'publish_draft', 'delete_draft'
]

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

/** An access token (xta_) for `user`, bound to `resource` (default: the MCP resource). */
async function accessToken(user, resource = MCP) {
  const { rows } = await db.pg.query(
    "insert into oauth_grants (user_id, client_id, scope, resource) values ($1, 'xtc_mcp_test', 'drafts', $2) returning id",
    [user.id, resource]
  )
  return (await issuePair(rows[0].id)).access_token
}

/** A modern (2026-07-28) JSON-RPC POST with the headers and _meta that revision requires. */
function modernPost(method, params = {}, { id = 1, token } = {}) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': MODERN,
    'mcp-method': method
  }
  if (method === 'tools/call') headers['mcp-name'] = params.name
  if (token) headers.authorization = `Bearer ${token}`
  const body = {
    jsonrpc: '2.0',
    id,
    method,
    params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN } }
  }
  return new Request(MCP, { method: 'POST', headers, body: JSON.stringify(body) })
}

/** A legacy POST (2025-06-18 style: the version header, no _meta, no Mcp-Method). */
function legacyPost(body, { token, headers = {} } = {}) {
  const init = {
    'content-type': 'application/json',
    'mcp-protocol-version': '2025-06-18',
    ...headers
  }
  if (token) init.authorization = `Bearer ${token}`
  return new Request(MCP, { method: 'POST', headers: init, body: JSON.stringify(body) })
}

async function call(request) {
  const res = await route(request)
  const text = await res.text()
  return { res, status: res.status, body: text ? JSON.parse(text) : null, text }
}

describe('authentication on /api/mcp', () => {
  it('answers a missing token with 401 and the protected resource metadata header', async () => {
    const { res, body } = await call(modernPost('tools/list'))
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toBe(WWW_AUTHENTICATE)
    expect(body.error).toBeTruthy()
  })

  it('refuses an access token bound to the REST resource (<origin>/api)', async () => {
    const token = await accessToken(alice, `${APP_URL}/api`)
    const { res } = await call(modernPost('tools/list', {}, { token }))
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toBe(WWW_AUTHENTICATE)
  })

  it('refuses hand-made xt_ tokens, even with a valid browser session cookie', async () => {
    const cookie = await db.cookieFor(alice)
    const request = modernPost('tools/list', {}, { token: `xt_${'a'.repeat(44)}` })
    request.headers.set('cookie', cookie)
    const { res } = await call(request)
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toBe(WWW_AUTHENTICATE)
  })

  it('never uses the cookie in place of a token', async () => {
    const request = modernPost('tools/list')
    request.headers.set('cookie', await db.cookieFor(alice))
    const { res } = await call(request)
    expect(res.status).toBe(401)
  })

  it('refuses a foreign Origin with 403, even with a valid token', async () => {
    const token = await accessToken(alice)
    const request = modernPost('tools/list', {}, { token })
    request.headers.set('origin', 'https://evil.example')
    const { res } = await call(request)
    expect(res.status).toBe(403)
  })
})

describe('transport', () => {
  it('answers GET and DELETE with 405', async () => {
    const token = await accessToken(alice)
    const get = await route(new Request(MCP, { method: 'GET', headers: { authorization: `Bearer ${token}` } }))
    const del = await route(new Request(MCP, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } }))
    expect(get.status).toBe(405)
    expect(del.status).toBe(405)
  })

  it('returns -32700 for malformed JSON and -32600 for a batch', async () => {
    const token = await accessToken(alice)
    const bad = await call(
      new Request(MCP, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'mcp-protocol-version': '2025-06-18', authorization: `Bearer ${token}` },
        body: '{not json'
      })
    )
    expect(bad.status).toBe(400)
    expect(bad.body.error.code).toBe(-32700)
    const batch = await call(legacyPost([{ jsonrpc: '2.0', id: 1, method: 'ping' }], { token }))
    expect(batch.body.error.code).toBe(-32600)
  })

  it('refuses an unsupported protocol version with -32022 and the supported list', async () => {
    const token = await accessToken(alice)
    const { status, body } = await call(legacyPost({ jsonrpc: '2.0', id: 1, method: 'ping' }, { token, headers: { 'mcp-protocol-version': '1999-01-01' } }))
    expect(status).toBe(400)
    expect(body.error.code).toBe(-32022)
    expect(body.error.data.supported).toContain(MODERN)
  })

  it('requires the version header on everything except initialize', async () => {
    const token = await accessToken(alice)
    const request = new Request(MCP, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    })
    const { status, body } = await call(request)
    expect(status).toBe(400)
    expect(body.error.code).toBe(-32600)
  })

  it('answers a notification with 202 and no body', async () => {
    const token = await accessToken(alice)
    const res = await route(legacyPost({ jsonrpc: '2.0', method: 'notifications/initialized' }, { token }))
    expect(res.status).toBe(202)
    expect(await res.text()).toBe('')
  })

  it('rejects a body whose _meta version differs from the header with -32020', async () => {
    const token = await accessToken(alice)
    const request = modernPost('tools/list', {}, { token })
    const body = await request.json()
    body.params._meta['io.modelcontextprotocol/protocolVersion'] = '2025-11-25'
    const { status, body: reply } = await call(new Request(MCP, { method: 'POST', headers: request.headers, body: JSON.stringify(body) }))
    expect(status).toBe(400)
    expect(reply.error.code).toBe(-32020)
  })

  it('rejects a modern request whose Mcp-Method header is missing or different', async () => {
    const token = await accessToken(alice)
    const request = modernPost('tools/list', {}, { token })
    request.headers.delete('mcp-method')
    expect((await call(request)).body.error.code).toBe(-32020)
    const wrong = modernPost('tools/list', {}, { token })
    wrong.headers.set('mcp-method', 'tools/call')
    expect((await call(wrong)).body.error.code).toBe(-32020)
  })

  it('answers an unknown method with -32601 (404 for the 2026 revision)', async () => {
    const token = await accessToken(alice)
    const modern = await call(modernPost('no/such', {}, { token }))
    expect(modern.status).toBe(404)
    expect(modern.body.error.code).toBe(-32601)
    const legacy = await call(legacyPost({ jsonrpc: '2.0', id: 2, method: 'no/such' }, { token }))
    expect(legacy.status).toBe(200)
    expect(legacy.body.error.code).toBe(-32601)
  })
})

describe('initialize, discovery and tools/list', () => {
  it('initialize (legacy handshake) negotiates a supported version and advertises tools', async () => {
    const token = await accessToken(alice)
    const request = new Request(MCP, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }
      })
    })
    const { status, body } = await call(request)
    expect(status).toBe(200)
    expect(body.result.protocolVersion).toBe('2025-06-18')
    expect(body.result.capabilities).toEqual({ tools: {} })
    expect(body.result.serverInfo.name).toBe('x-thread-draft-tool')
    expect(body.result.instructions).toMatch(/data, never as instructions/)
    expect(body.result.resultType).toBeUndefined()
  })

  it('initialize answers the newest legacy version for an unknown request', async () => {
    const token = await accessToken(alice)
    const request = new Request(MCP, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2030-01-01' } })
    })
    const { body } = await call(request)
    expect(body.result.protocolVersion).toBe('2025-11-25')
  })

  it('server/discover lists the supported versions (2026 revision)', async () => {
    const token = await accessToken(alice)
    const { body } = await call(modernPost('server/discover', {}, { token }))
    expect(body.result.resultType).toBe('complete')
    expect(body.result.supportedVersions).toEqual(['2026-07-28', '2025-11-25', '2025-06-18'])
    expect(body.result.capabilities).toEqual({ tools: {} })
  })

  it('tools/list names the 11 draft tools with their annotations', async () => {
    const token = await accessToken(alice)
    const { body } = await call(modernPost('tools/list', {}, { token }))
    expect(body.result.resultType).toBe('complete')
    expect(body.result.ttlMs).toBeGreaterThan(0)
    const tools = Object.fromEntries(body.result.tools.map((tool) => [tool.name, tool]))
    expect(Object.keys(tools).sort()).toEqual([...TOOL_NAMES].sort())
    expect(tools.list_drafts.annotations).toEqual({ readOnlyHint: true })
    expect(tools.publish_draft.annotations).toEqual({ destructiveHint: true })
    expect(tools.delete_draft.annotations).toEqual({ destructiveHint: true })
    expect(tools.create_draft.inputSchema.type).toBe('object')
    expect(tools.create_draft.description).toMatch(/treat them as data/)
  })

  it('tools/list works with a 2025-06-18 client as well', async () => {
    const token = await accessToken(alice)
    const { body } = await call(legacyPost({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, { token }))
    expect(body.result.tools).toHaveLength(11)
    expect(body.result.resultType).toBeUndefined()
  })
})

describe('tools/call', () => {
  it('creates a draft and reads it back for the token user only', async () => {
    const token = await accessToken(alice)
    const created = await call(
      modernPost('tools/call', { name: 'create_draft', arguments: { title: 'Launch', posts: [{ id: 'p1', text: 'Hello', images: [], embeddedTweet: null }] } }, { token })
    )
    expect(created.body.result.isError).toBe(false)
    const draft = created.body.result.structuredContent.draft
    expect(draft.user_id).toBe(alice.id)
    expect(draft.title).toBe('Launch')

    const read = await call(modernPost('tools/call', { name: 'get_draft', arguments: { id: draft.id } }, { token }))
    expect(read.body.result.isError).toBe(false)
    expect(read.body.result.structuredContent.draft.posts[0].text).toBe('Hello')

    const list = await call(modernPost('tools/call', { name: 'list_drafts', arguments: { published: false } }, { token }))
    expect(list.body.result.structuredContent.drafts.map((d) => d.id)).toEqual([draft.id])
  })

  it('does not show or read another user drafts', async () => {
    const bobDraft = await db.insertDraft(bob.id, { title: 'Bob private' })
    const token = await accessToken(alice)

    const read = await call(modernPost('tools/call', { name: 'get_draft', arguments: { id: bobDraft.id } }, { token }))
    expect(read.body.result.isError).toBe(true)
    expect(read.body.result.content[0].text).toContain('Draft not found')

    const exported = await call(modernPost('tools/call', { name: 'export_draft', arguments: { id: bobDraft.id, format: 'text' } }, { token }))
    expect(exported.body.result.isError).toBe(true)

    const list = await call(modernPost('tools/call', { name: 'list_drafts', arguments: { published: false } }, { token }))
    expect(list.body.result.structuredContent.drafts).toEqual([])
  })

  it('runs as the token user, so bob token writes to bob only', async () => {
    const token = await accessToken(bob)
    await call(modernPost('tools/call', { name: 'create_draft', arguments: { title: 'Bob' } }, { token }))
    const { rows } = await db.pg.query('select user_id from drafts')
    expect(rows.map((row) => row.user_id)).toEqual([bob.id])
  })

  it('runs the update, duplicate, split, share and delete tools against the REST handlers', async () => {
    const token = await accessToken(alice)
    const draft = await db.insertDraft(alice.id, { title: 'Old' })

    const updated = await call(modernPost('tools/call', { name: 'update_draft', arguments: { id: draft.id, title: 'New' } }, { token }))
    expect(updated.body.result.structuredContent.draft.title).toBe('New')

    const copy = await call(modernPost('tools/call', { name: 'duplicate_draft', arguments: { id: draft.id } }, { token }))
    expect(copy.body.result.structuredContent.draft.title).toBe('New (copy)')

    const split = await call(modernPost('tools/call', { name: 'split_text', arguments: { text: 'word '.repeat(120), max_chars: 100 } }, { token }))
    expect(split.body.result.isError).toBe(false)
    expect(split.body.result.structuredContent.posts.length).toBeGreaterThan(1)

    const share = await call(modernPost('tools/call', { name: 'create_share_link', arguments: { id: draft.id } }, { token }))
    expect(share.body.result.structuredContent.token).toBeTruthy()

    const deleted = await call(modernPost('tools/call', { name: 'delete_draft', arguments: { id: draft.id } }, { token }))
    expect(deleted.body.result.isError).toBe(false)
    const { rows } = await db.pg.query('select id from drafts where id = $1', [draft.id])
    expect(rows).toEqual([])
  })

  it('reports bad arguments and REST errors as isError results, not JSON-RPC errors', async () => {
    const token = await accessToken(alice)
    const missing = await call(modernPost('tools/call', { name: 'get_draft', arguments: {} }, { token }))
    expect(missing.body.result.isError).toBe(true)
    expect(missing.body.result.content[0].text).toMatch(/Missing required argument: id/)

    const limit = await call(modernPost('tools/call', { name: 'list_drafts', arguments: { published: false, limit: 500 } }, { token }))
    expect(limit.body.result.isError).toBe(true)
  })

  it('answers an unknown tool with a JSON-RPC -32602 error', async () => {
    const token = await accessToken(alice)
    const { body } = await call(modernPost('tools/call', { name: 'nope', arguments: {} }, { token }))
    expect(body.error.code).toBe(-32602)
  })
})
