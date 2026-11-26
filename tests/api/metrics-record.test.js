// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupTestDb, apiRequest, APP_URL } from './helpers/db.js'
import { issuePair } from '../../server/oauth/tokens.js'
import { route } from '../../server/router.js'
import { setQueryImpl } from '../../server/db.js'
import { flushMetrics, rowOf } from '../../server/metrics/record.js'

// Observability plan O2 (#333): one row per request in metrics_hourly, written after the answer.
// The API suite turns writes off by default (tests/api/helpers/metrics-off.js); this file turns them on.
let db
let cookie
let mcpToken

// A signed-in list of drafts runs SQL, so it is a request that writes (q > 0).
const listDrafts = () => apiRequest('/api/auth/me', { cookie })

beforeAll(async () => {
  db = await setupTestDb()
  process.env.METRICS_DISABLED = '0'
  const alice = await db.insertUser({ github_id: 77, login: 'metrics-test' })
  cookie = await db.cookieFor(alice)
  await db.pg.query(
    "insert into oauth_clients (client_id, kind, client_name) values ('xtc_mcp_test', 'registered', 'Test') on conflict do nothing"
  )
  const { rows: grant } = await db.pg.query(
    "insert into oauth_grants (user_id, client_id, scope, resource) values ($1, 'xtc_mcp_test', 'drafts', $2) returning id",
    [alice.id, `${APP_URL}/api/mcp`]
  )
  mcpToken = (await issuePair(grant[0].id)).access_token
})

// An MCP call from a signed-in client (the MCP endpoint; caller kind is the client's app family, O3).
function mcpCall(name, token = mcpToken) {
  return new Request(`${APP_URL}/api/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'tools/call',
      'mcp-name': name
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: { published: false }, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } }
    })
  })
}

afterAll(() => {
  process.env.METRICS_DISABLED = '1'
})

beforeEach(async () => {
  await flushMetrics()
  await db.pg.exec('delete from metrics_hourly')
})

const rows = async () => (await db.pg.query('select * from metrics_hourly order by route, op, caller')).rows
const count = (r) => Number(r.n)

describe('recording one request', () => {
  it('adds exactly 1 to n, and to no status-class counter for a 200', async () => {
    const res = await route(listDrafts())
    await flushMetrics()
    expect(res.status).toBe(200)
    const [row] = await rows()
    expect(count(row)).toBe(1)
    expect(['n_3xx', 'n_4xx', 'n_429', 'n_5xx'].filter((c) => Number(row[c]) !== 0)).toEqual([])
    expect(row.buckets).toHaveLength(65)
    expect(row.buckets.reduce((a, b) => a + b, 0)).toBe(1)
  })

  it('counts a 4xx answer once in n_4xx', async () => {
    const res = await route(apiRequest('/api/drafts/11111111-1111-4111-8111-111111111111', { cookie }))
    await flushMetrics()
    expect(res.status).toBe(404)
    const [row] = await rows()
    expect([Number(row.n_4xx), Number(row.n_5xx), Number(row.n_3xx)]).toEqual([1, 0, 0])
  })

  it('two requests in the same hour share one row', async () => {
    await route(listDrafts())
    await route(listDrafts())
    await flushMetrics()
    const all = await rows()
    expect(all).toHaveLength(1)
    expect(count(all[0])).toBe(2)
  })

  it('stores the route template and never an id or xt_ value', async () => {
    const id = '22222222-2222-4222-8222-222222222222'
    await route(apiRequest(`/api/drafts/${id}`, { cookie }))
    await flushMetrics()
    const text = JSON.stringify(await rows())
    expect(text).toContain('GET /drafts/:id')
    expect(text).not.toContain(id)
    expect(text).not.toContain('xt_')
  })
})

describe('MCP calls', () => {
  it('an unknown tool is a JSON-RPC error: one row, caller mcp:other, op tools/call, counted once in n_4xx', async () => {
    await route(mcpCall('no_such_tool'))
    await flushMetrics()
    const [row] = await rows()
    expect(row.route).toBe('POST /mcp')
    expect(row.caller).toBe('mcp:other')
    expect(row.op).toBe('tools/call')
    expect([Number(row.n_4xx), Number(row.n_429), Number(row.n_tool_error)]).toEqual([1, 0, 0])
  })

  it('a call through a grant of the Claude web client is stored with caller mcp:claude, never the client_id', async () => {
    const alice = await db.pg.query("select id from users where login = 'metrics-test'")
    await db.pg.query(
      `insert into oauth_clients (client_id, kind, client_name, redirect_uris)
       values ('xtc_mcp_claude_web', 'registered', 'Claude', '{https://claude.ai/api/mcp/auth_callback}') on conflict do nothing`
    )
    const { rows: grant } = await db.pg.query(
      "insert into oauth_grants (user_id, client_id, scope, resource) values ($1, 'xtc_mcp_claude_web', 'drafts', $2) returning id",
      [alice.rows[0].id, `${APP_URL}/api/mcp`]
    )
    const token = (await issuePair(grant[0].id)).access_token
    await route(mcpCall('no_such_tool', token))
    await flushMetrics()
    const [row] = await rows()
    expect(row.caller).toBe('mcp:claude')
    expect(JSON.stringify(row)).not.toContain('xtc_mcp_claude_web')
  })
})

describe('rate limit', () => {
  it('the 121st tools/call in a minute is a rate-limited answer and counts once in n_429 for its tool', async () => {
    for (let i = 0; i < 121; i += 1) await route(mcpCall('list_drafts'))
    await flushMetrics()
    const [row] = (await rows()).filter((r) => r.op === 'tool:list_drafts')
    expect(count(row)).toBe(121)
    expect([Number(row.n_429), Number(row.n_4xx)]).toEqual([1, 0])
  }, 60000)
})

describe('requests that use no SQL', () => {
  it('a signed-in cookie request through authenticate() is caller web, not anon', async () => {
    await route(listDrafts())
    await flushMetrics()
    expect((await rows()).map((r) => r.caller)).toEqual(['web'])
  })

  it('sign-out (readSession only, no authenticate) is caller web and one row', async () => {
    const bob = await db.insertUser({ github_id: 78, login: 'metrics-logout' })
    const bobCookie = await db.cookieFor(bob)
    const res = await route(apiRequest('/api/auth/logout', { method: 'POST', cookie: bobCookie }))
    await flushMetrics()
    expect(res.status).toBeLessThan(500)
    const logout = (await rows()).filter((r) => r.route === 'POST /auth/logout')
    expect(logout).toHaveLength(1)
    expect(logout[0].caller).toBe('web')
  })

  it('a health check runs no SQL, and its count is written with the next request that does', async () => {
    const health = await route(apiRequest('/api/health'))
    expect(health.headers.get('server-timing')).toContain('q;desc="0"')
    await flushMetrics()
    expect((await rows()).some((r) => r.route === 'GET /health')).toBe(false)

    await route(listDrafts())
    await flushMetrics()
    const healthRow = (await rows()).find((r) => r.route === 'GET /health')
    expect(healthRow).toBeDefined()
    expect(count(healthRow)).toBe(1)
  })
})

describe('failure and switch', () => {
  it('a write that fails still returns the normal answer and logs no error details', async () => {
    const original = async (text, params = []) => {
      const result = await db.pg.query(text, params)
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length }
    }
    setQueryImpl(async (text, params = []) => {
      if (text.includes('metrics_hourly')) throw new Error('injected failure with secret-text')
      return original(text, params)
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const res = await route(listDrafts())
      expect(res.status).toBe(200)
      await flushMetrics()
      expect(warn).toHaveBeenCalledWith('[metrics] write failed')
      expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-text')
    } finally {
      warn.mockRestore()
      setQueryImpl(original)
    }
  })

  it('METRICS_DISABLED=1 writes nothing', async () => {
    process.env.METRICS_DISABLED = '1'
    try {
      await route(listDrafts())
      await flushMetrics()
      expect(await rows()).toEqual([])
    } finally {
      process.env.METRICS_DISABLED = '0'
    }
  })
})

describe('rowOf (pure mapping)', () => {
  const base = {
    method: 'GET', route: '/drafts/:id', rpc: null, tool: null, caller: 'web', q: 1, dbMs: 2, conn: 0,
    cold: false, rateLimited: false, rpcError: false, toolError: false
  }
  const at = Date.parse('2026-11-25T10:42:17Z')

  it('keys a row by method and template, and an unmatched path by unmatched alone', () => {
    expect(rowOf(base, 200, 5, at).route).toBe('GET /drafts/:id')
    expect(rowOf({ ...base, route: 'unmatched' }, 404, 5, at).route).toBe('unmatched')
  })

  it('uses the UTC hour start', () => {
    expect(rowOf(base, 200, 5, at).hour).toBe('2026-11-25T10:00:00.000Z')
  })

  it('counts a 429 HTTP status in n_429, not n_4xx', () => {
    const r = rowOf(base, 429, 5, at)
    expect([r.n_429, r.n_4xx]).toEqual([1, 0])
  })

  it('counts a rate-limited MCP call (HTTP 200) in n_429', () => {
    const r = rowOf({ ...base, rateLimited: true }, 200, 5, at)
    expect([r.n_429, r.n_4xx]).toEqual([1, 0])
  })

  it('counts a JSON-RPC error (HTTP 200) in n_4xx and a tool error in n_tool_error', () => {
    const r = rowOf({ ...base, rpcError: true, toolError: true }, 200, 5, at)
    expect([r.n_4xx, r.n_tool_error]).toEqual([1, 1])
  })

  it('names a known tool as tool:<name>, and a tools/list as its method', () => {
    expect(rowOf({ ...base, rpc: 'tools/call', tool: 'get_draft' }, 200, 5, at).op).toBe('tool:get_draft')
    expect(rowOf({ ...base, rpc: 'tools/list', tool: 'list' }, 200, 5, at).op).toBe('tools/list')
    expect(rowOf({ ...base, rpc: 'tools/call', tool: null }, 200, 5, at).op).toBe('tools/call')
  })

  it('stores any caller outside the fixed list as anon', () => {
    expect(rowOf({ ...base, caller: 'someone-else' }, 200, 5, at).caller).toBe('anon')
  })
})
