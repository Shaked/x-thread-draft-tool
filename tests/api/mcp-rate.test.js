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
})

async function accessToken(user) {
  const { rows } = await db.pg.query(
    "insert into oauth_grants (user_id, client_id, scope, resource) values ($1, 'xtc_mcp_test', 'drafts', $2) returning id",
    [user.id, MCP]
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

  it('deletes rows older than one day and keeps recent ones', async () => {
    await db.pg.query(
      `insert into mcp_rate_limits (user_id, minute, calls) values
         ($1, date_trunc('minute', now()) - interval '2 days', 3),
         ($1, date_trunc('minute', now()) - interval '1 hour', 4)`,
      [alice.id]
    )
    await cleanupExpired()
    const { rows } = await db.pg.query('select calls from mcp_rate_limits where user_id = $1 order by minute', [alice.id])
    expect(rows.map((row) => row.calls)).toEqual([4])
  })
})
