// @vitest-environment node
// Tool-call rate limit on POST /api/mcp (plan M8): 120 tools/call per user per minute.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({ putBlob: vi.fn(), deleteBlobUrls: vi.fn(async () => {}) }))

import { route } from '../../server/router.js'
import { cleanupExpired, issuePair } from '../../server/oauth/tokens.js'
import { APP_URL, setupTestDb } from './helpers/db.js'

const MCP = `${APP_URL}/api/mcp`
const MODERN = '2026-07-28'

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
  await waitForFreshMinute()
})

/**
 * Waits, only when fewer than 2 s are left in the database minute, until the next minute starts. The counts are keyed on
 * the minute, so a test that seeds a count and then calls must not see the minute change between the two (flaky #594).
 */
async function waitForFreshMinute() {
  const { rows } = await db.pg.query("select extract(epoch from date_trunc('minute', now()) + interval '1 minute' - now()) as left_s")
  const leftMs = Number(rows[0].left_s) * 1000
  if (leftMs < 2000) await new Promise((resolve) => setTimeout(resolve, leftMs + 50))
}

async function accessToken(user, resource = MCP) {
  const { rows } = await db.pg.query(
    "insert into oauth_grants (user_id, client_id, scope, resource) values ($1, 'xtc_mcp_test', 'drafts', $2) returning id",
    [user.id, resource]
  )
  return (await issuePair(rows[0].id)).access_token
}

function listDrafts(token) {
  return new Request(MCP, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
      'mcp-protocol-version': MODERN,
      'mcp-method': 'tools/call',
      'mcp-name': 'list_drafts'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'list_drafts', arguments: { published: false }, _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN } }
    })
  })
}

async function callTool(token) {
  const res = await route(listDrafts(token))
  return (await res.json()).result
}

/** Sets the call count for the current minute for one user (the database clock, as the code uses). */
async function setCallsThisMinute(user, calls) {
  await db.pg.query(
    `insert into mcp_rate_limits (user_id, minute, calls) values ($1, date_trunc('minute', now()), $2)
     on conflict (user_id, minute) do update set calls = excluded.calls`,
    [user.id, calls]
  )
}

describe('tools/call rate limit (M8)', () => {
  it('lets 120 calls through in a minute', async () => {
    const token = await accessToken(alice)
    await setCallsThisMinute(alice, 119)
    const result = await callTool(token)
    expect(result.isError).toBe(false)
  })

  it('returns a tool error (not a JSON-RPC error) for the 121st call in a minute', async () => {
    const token = await accessToken(alice)
    await setCallsThisMinute(alice, 120)
    const res = await route(listDrafts(token))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.error).toBeUndefined()
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toBe('Rate limit reached: at most 120 tool calls per minute. Wait one minute.')
  })

  it('counts each call: the 121st of real calls is the one refused', async () => {
    const token = await accessToken(alice)
    await setCallsThisMinute(alice, 118)
    expect((await callTool(token)).isError).toBe(false) // 119
    expect((await callTool(token)).isError).toBe(false) // 120
    expect((await callTool(token)).isError).toBe(true) // 121
  })

  it('does not affect another user', async () => {
    const aliceToken = await accessToken(alice)
    const bobToken = await accessToken(bob)
    await setCallsThisMinute(alice, 120)
    expect((await callTool(aliceToken)).isError).toBe(true)
    expect((await callTool(bobToken)).isError).toBe(false)
  })

  it('starts a new count in the next minute', async () => {
    const token = await accessToken(alice)
    // A full count in an earlier minute does not count against this one.
    await db.pg.query(
      `insert into mcp_rate_limits (user_id, minute, calls) values ($1, date_trunc('minute', now()) - interval '1 minute', 500)`,
      [alice.id]
    )
    expect((await callTool(token)).isError).toBe(false)
  })

  it('deletes rows older than eight days and keeps recent ones (admin plan A7: 8 days, was 1)', async () => {
    await db.pg.query(
      `insert into mcp_rate_limits (user_id, minute, calls) values
         ($1, date_trunc('minute', now()) - interval '9 days', 3),
         ($1, date_trunc('minute', now()) - interval '7 days', 5),
         ($1, date_trunc('minute', now()) - interval '1 hour', 4)`,
      [alice.id]
    )
    await cleanupExpired()
    const { rows } = await db.pg.query('select calls from mcp_rate_limits where user_id = $1 order by minute', [alice.id])
    expect(rows.map((row) => row.calls)).toEqual([5, 4])
  })
})

const RATE_MESSAGE = 'Rate limit reached: at most 120 tool calls per minute. Wait one minute.'

/** A POST to /api/mcp. `token` adds a bearer header when given; a string body is sent as it is. */
function post(token, body, headers = {}) {
  return new Request(MCP, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  })
}

/** A tools/call of `name` in the 2026-07-28 form. `extra` is spliced into params (for example { arguments: null }). */
function toolCallWith(token, name, extra = {}) {
  return post(
    token,
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, ...extra, _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN } } },
    { accept: 'application/json, text/event-stream', 'mcp-protocol-version': MODERN, 'mcp-method': 'tools/call', 'mcp-name': name }
  )
}

/**
 * The count in the newest minute row of one user, or undefined when there is no row.
 * It is the row the call wrote. Matching now() here instead would miss it when the minute changes
 * between the call and this read (flaky #594).
 */
async function latestCalls(user) {
  const { rows } = await db.pg.query(
    'select calls from mcp_rate_limits where user_id = $1 order by minute desc limit 1',
    [user.id]
  )
  return rows[0]?.calls
}

describe('tool-call count in the auth statement (P4)', () => {
  it.each([
    ['absent', {}],
    ['null', { arguments: null }]
  ])('refuses the 121st call with %s arguments, and counts it once', async (_label, extra) => {
    const token = await accessToken(alice)
    await setCallsThisMinute(alice, 120)
    const body = await (await route(toolCallWith(token, 'whoami', extra))).json()
    expect(body.error).toBeUndefined()
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toBe(RATE_MESSAGE)
    expect(await latestCalls(alice)).toBe(121)
  })

  it.each([
    ['absent', {}],
    ['null', { arguments: null }]
  ])('runs and counts the 120th call with %s arguments', async (_label, extra) => {
    const token = await accessToken(alice)
    await setCallsThisMinute(alice, 119)
    const body = await (await route(toolCallWith(token, 'whoami', extra))).json()
    expect(body.result.isError).toBe(false)
    expect(await latestCalls(alice)).toBe(120)
  })

  it('does not count an unknown tool, nor arguments that are not an object', async () => {
    const token = await accessToken(alice)
    await setCallsThisMinute(alice, 120)
    const unknown = await (await route(toolCallWith(token, 'no_such_tool'))).json()
    expect(unknown.error.code).toBe(-32602)
    const notObject = await (await route(toolCallWith(token, 'whoami', { arguments: 'text' }))).json()
    expect(notObject.error.code).toBe(-32602)
    expect(await latestCalls(alice)).toBe(120)
  })

  it('answers 401 without a valid token, even when the body is bad', async () => {
    const bad = '{not json'
    const none = await route(post(null, bad))
    expect(none.status).toBe(401)
    expect(none.headers.get('www-authenticate')).toContain('resource_metadata=')
    const wrong = await route(post(`xta_${'a'.repeat(43)}`, bad))
    expect(wrong.status).toBe(401)
    // With a valid token the same body is a parse error, as before.
    const token = await accessToken(alice)
    const parsed = await route(post(token, bad))
    expect(parsed.status).toBe(400)
    expect((await parsed.json()).error.code).toBe(-32700)
  })

  it('does not count initialize or tools/list', async () => {
    const token = await accessToken(alice)
    const legacy = { 'mcp-protocol-version': '2025-06-18' }
    const init = await route(post(token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }, legacy))
    expect(init.status).toBe(200)
    for (let id = 2; id <= 4; id += 1) {
      expect((await route(post(token, { jsonrpc: '2.0', id, method: 'tools/list' }, legacy))).status).toBe(200)
    }
    expect(await latestCalls(alice)).toBeUndefined()
    // A tools/call is counted, so the count starts at 1 for the next call.
    await route(toolCallWith(token, 'whoami'))
    expect(await latestCalls(alice)).toBe(1)
  })

  it('gives 401 for a revoked grant, an expired token and a token for another resource', async () => {
    const revoked = await accessToken(alice)
    await db.pg.query('update oauth_grants set revoked_at = now() where user_id = $1', [alice.id])
    expect((await route(toolCallWith(revoked, 'whoami'))).status).toBe(401)

    const expired = await accessToken(bob)
    await db.pg.query("update oauth_tokens set expires_at = now() - interval '1 second'")
    expect((await route(toolCallWith(expired, 'whoami'))).status).toBe(401)
    expect(await latestCalls(bob)).toBeUndefined()

    const otherResource = await accessToken(alice, `${APP_URL}/api`)
    const res = await route(toolCallWith(otherResource, 'whoami'))
    expect(res.status).toBe(401)
    expect(await latestCalls(alice)).toBeUndefined()
  })
})
