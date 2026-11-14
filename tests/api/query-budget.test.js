// @vitest-environment node
// Query budget and request timing (plan P1, docs/plans/performance.md section 5 P1). `q` is the
// number of SQL round trips of one request, read from the server-timing header. Later tasks lower
// these numbers on purpose; raising one needs an Opus APPROVE and a reason in the pull request.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({
  putBlob: vi.fn(async (pathname) => ({ url: `https://store.public.blob.vercel-storage.com/${pathname}` })),
  deleteBlobUrls: vi.fn(async () => {})
}))

import { route } from '../../server/router.js'
import { issuePair } from '../../server/oauth/tokens.js'
import { createApiToken } from '../../server/tokens.js'
import { measured } from '../../server/perf.js'
import { setQueryImpl, transaction } from '../../server/db.js'
import { APP_URL, apiRequest, setupTestDb } from './helpers/db.js'

const MCP = `${APP_URL}/api/mcp`
const MODERN = '2026-07-28'
const IMAGE_HOST = 'https://store.public.blob.vercel-storage.com'

let db
let alice
let cookie
let oauthToken
let apiToken
let draft

beforeAll(async () => {
  db = await setupTestDb()
})

beforeEach(async () => {
  await db.reset()
  await db.pg.query(
    "insert into oauth_clients (client_id, kind, client_name) values ('xtc_mcp_test', 'registered', 'Test') on conflict do nothing"
  )
  alice = await db.insertUser({ github_id: 1, login: 'alice' })
  cookie = await db.cookieFor(alice)
  const { rows } = await db.pg.query(
    "insert into oauth_grants (user_id, client_id, scope, resource) values ($1, 'xtc_mcp_test', 'drafts', $2) returning id",
    [alice.id, MCP]
  )
  oauthToken = (await issuePair(rows[0].id)).access_token
  apiToken = (await createApiToken(alice.id, { name: 'budget' })).token
  // One draft of 10 posts; post p2 carries one image under the caller's drafts/<uid>/ prefix.
  const posts = Array.from({ length: 10 }, (_, i) => ({
    id: `p${i + 1}`,
    text: `Post ${i + 1} about the budget test`,
    images: [],
    embeddedTweet: null
  }))
  draft = await db.insertDraft(alice.id, { title: 'Budget', posts })
  const withImage = posts.map((p) =>
    p.id === 'p2' ? { ...p, images: [{ url: `${IMAGE_HOST}/drafts/${alice.id}/${draft.id}/x.png` }] } : p
  )
  await db.pg.query('update drafts set posts = $1::jsonb where id = $2', [JSON.stringify(withImage), draft.id])
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** A JSON-RPC request in the 2025-06-18 form (no _meta, no Mcp-* headers). */
function legacy(message) {
  return new Request(MCP, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'mcp-protocol-version': '2025-06-18', authorization: `Bearer ${oauthToken}` },
    body: JSON.stringify({ jsonrpc: '2.0', ...message })
  })
}

/** A tools/call in the 2026-07-28 form, as tests/api/mcp-five-requests.test.js sends it. */
function toolCall(name, args = {}) {
  return new Request(MCP, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${oauthToken}`,
      'mcp-protocol-version': MODERN,
      'mcp-method': 'tools/call',
      'mcp-name': name
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args, _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN } }
    })
  })
}

/** Runs one request and returns its q from the server-timing header, checking the header and one [perf] line. */
async function roundTrips(spy, request) {
  const before = spy.mock.calls.length
  const res = await route(request)
  const header = res.headers.get('server-timing') ?? ''
  expect(header).toMatch(/total;dur=[\d.]+/)
  expect(header).toMatch(/cold;desc="[01]"/)
  const perf = spy.mock.calls.slice(before).filter(([line]) => String(line).startsWith('[perf] '))
  expect(perf).toHaveLength(1)
  const q = header.match(/q;desc="(\d+)"/)
  return Number(q[1])
}

function spyPerf() {
  return vi.spyOn(console, 'log').mockImplementation(() => {})
}

describe('query budget per flow (plan section 3.2)', () => {
  it('MCP initialize: 1', async () => {
    const spy = spyPerf()
    const q = await roundTrips(spy, legacy({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }))
    expect(q).toBe(1)
  })

  it('MCP tools/list: 1', async () => {
    const spy = spyPerf()
    expect(await roundTrips(spy, legacy({ id: 2, method: 'tools/list' }))).toBe(1)
  })

  it('MCP list_drafts: 3', async () => {
    const spy = spyPerf()
    expect(await roundTrips(spy, toolCall('list_drafts', { published: false }))).toBe(3)
  })

  it('MCP get_draft: 3', async () => {
    const spy = spyPerf()
    expect(await roundTrips(spy, toolCall('get_draft', { id: draft.id }))).toBe(3)
  })

  it('MCP add_post: 7', async () => {
    const spy = spyPerf()
    expect(await roundTrips(spy, toolCall('add_post', { id: draft.id, text: 'A new post' }))).toBe(7)
  })

  it('MCP update_post: 6', async () => {
    const spy = spyPerf()
    expect(await roundTrips(spy, toolCall('update_post', { id: draft.id, post_id: 'p3', text: 'Edited' }))).toBe(6)
  })

  it('MCP remove_post of the post with an image: 9', async () => {
    const spy = spyPerf()
    expect(await roundTrips(spy, toolCall('remove_post', { id: draft.id, post_id: 'p2' }))).toBe(9)
  })

  it('REST GET /api/drafts with an xt_ token: 3', async () => {
    const spy = spyPerf()
    const q = await roundTrips(spy, apiRequest('/api/drafts?published=false', { headers: { authorization: `Bearer ${apiToken}` } }))
    expect(q).toBe(3)
  })

  it('REST GET /api/drafts with the session cookie: 1', async () => {
    const spy = spyPerf()
    expect(await roundTrips(spy, apiRequest('/api/drafts?published=false', { cookie }))).toBe(1)
  })

  it('REST PATCH /api/drafts/:id with the cookie and a new title: 4', async () => {
    const spy = spyPerf()
    const q = await roundTrips(spy, apiRequest(`/api/drafts/${draft.id}`, { method: 'PATCH', cookie, body: { title: 'Changed' } }))
    expect(q).toBe(4)
  })
})

describe('[perf] log safety (plan P1, step 6)', () => {
  it('logs route templates only: no token, draft id, Bearer, xt_, xta_ or cookie', async () => {
    const spy = spyPerf()
    const created = await route(apiRequest(`/api/drafts/${draft.id}/share-tokens`, { method: 'POST', cookie, body: { one_time: false } }))
    const { token: shareToken } = await created.json()
    await route(apiRequest(`/api/share/${shareToken}.md`))
    await route(apiRequest(`/api/drafts/${draft.id}`, { cookie }))
    await route(apiRequest(`/api/drafts/${draft.id}/share-tokens`, { method: 'POST', cookie, body: { one_time: false } }))
    await route(apiRequest(`/api/nothing-here/${draft.id}`, { cookie }))

    const lines = spy.mock.calls.map(([line]) => String(line)).filter((line) => line.startsWith('[perf] '))
    expect(lines).toHaveLength(5)
    const text = lines.join('\n')
    for (const secret of [shareToken, draft.id, 'Bearer', 'xt_', 'xta_', 'cookie']) {
      expect(text).not.toContain(secret)
    }
    expect(lines.map((line) => JSON.parse(line.slice('[perf] '.length)).p)).toEqual([
      '/drafts/:id/share-tokens',
      '/share/:token',
      '/drafts/:id',
      '/drafts/:id/share-tokens',
      'unmatched'
    ])
  })
})

describe('connection time (plan P1, step 4)', () => {
  it('a transaction that opens a new connection reports conn 1 and no statement (q 0)', async () => {
    // Real pool code path: no PGlite, a closed port, so connect() fails at once. The connect time
    // is still counted in db and conn, never in q.
    const spy = spyPerf()
    const saved = process.env.DATABASE_URL
    process.env.DATABASE_URL = 'postgres://xt:xt@127.0.0.1:1/xt'
    setQueryImpl(null)
    try {
      const handler = measured(async () => {
        await transaction(async (q) => q('select 1')).catch(() => {})
        return new Response('ok')
      })
      const res = await handler(new Request(`${APP_URL}/api/x`))
      const header = res.headers.get('server-timing') ?? ''
      expect(header).toContain('q;desc="0"')
      expect(header).toContain('conn;desc="1"')
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      if (saved === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = saved
      setQueryImpl(async (text, params = []) => {
        const result = await db.pg.query(text, params)
        return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length }
      })
    }
  })
})
