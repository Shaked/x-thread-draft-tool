// @vitest-environment node
// The five requests from the real-client check list (docs/plans/mcp-clients.md, M11), run end to
// end through POST /api/mcp by a client that holds a real OAuth token: list, create from text,
// edit the second post, share link, delete, then list again after a token refresh. This proves
// the server side of the check list without a person. It does not prove what Claude, Claude
// Code, Codex or ChatGPT do on their own side; the client contract suite
// (tests/api/mcp-contract.test.js, plan M11) covers the wire contract they rely on.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({ putBlob: vi.fn(), deleteBlobUrls: vi.fn(async () => {}) }))

import { route } from '../../server/router.js'
import { issuePair } from '../../server/oauth/tokens.js'
import { APP_URL, setupTestDb } from './helpers/db.js'

const MCP = `${APP_URL}/api/mcp`
const FORM = { 'content-type': 'application/x-www-form-urlencoded' }
const MODERN = '2026-07-28'

let db
let alice

beforeAll(async () => {
  db = await setupTestDb()
})

beforeEach(async () => {
  await db.reset()
  await db.pg.query(
    "insert into oauth_clients (client_id, kind, client_name) values ('xtc_mcp_test', 'registered', 'Test') on conflict do nothing"
  )
  alice = await db.insertUser({ github_id: 1, login: 'alice' })
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function grant() {
  const { rows } = await db.pg.query(
    "insert into oauth_grants (user_id, client_id, scope, resource) values ($1, 'xtc_mcp_test', 'drafts', $2) returning id",
    [alice.id, MCP]
  )
  return rows[0].id
}

function rpc(token, name, args = {}, id = 1) {
  return route(
    new Request(MCP, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
        'mcp-protocol-version': MODERN,
        'mcp-method': 'tools/call',
        'mcp-name': name
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name, arguments: args, _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN } }
      })
    })
  )
}

async function call(token, name, args, id) {
  const res = await rpc(token, name, args, id)
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.error).toBeUndefined()
  return body.result
}

describe('the five check-list requests, end to end (M11, server side)', () => {
  it('lists, creates from text, edits post 2, shares, deletes, and lists again after a refresh', async () => {
    const pair = await issuePair(await grant())
    let token = pair.access_token

    // 1. "List my drafts."
    const listed = await call(token, 'list_drafts', { published: false }, 1)
    expect(listed.isError).not.toBe(true)
    expect(listed.structuredContent.drafts).toEqual([])

    // 2. "Turn this text into a thread draft titled MCP test: <three sentences>."
    const created = await call(
      token,
      'create_thread_from_text',
      {
        title: 'MCP test',
        text: 'First sentence about the connector. Second sentence about the drafts. Third sentence about the test.',
        max_chars: 80
      },
      2
    )
    expect(created.isError).not.toBe(true)
    const draft = created.structuredContent.draft
    expect(draft.title).toBe('MCP test')
    expect(draft.posts.length).toBeGreaterThanOrEqual(2)
    const secondPostId = draft.posts[1].id

    // 3. "Change the second post to say: edited by MCP."
    const edited = await call(token, 'update_post', { id: draft.id, post_id: secondPostId, text: 'edited by MCP' }, 3)
    expect(edited.isError).not.toBe(true)
    const afterEdit = await call(token, 'get_draft', { id: draft.id }, 4)
    expect(afterEdit.structuredContent.draft.posts[1].text).toBe('edited by MCP')

    // 4. "Give me a one-time share link for it."
    const shared = await call(token, 'create_share_link', { id: draft.id }, 5)
    expect(shared.isError).not.toBe(true)
    const link = shared.structuredContent ?? JSON.parse(shared.content[0].text)
    expect(link.preview_url).toMatch(/\/x-thread-preview\//)
    // The link works once: the first read is 200, the second is 410.
    const first = await route(new Request(link.markdown_url))
    expect(first.status).toBe(200)
    const second = await route(new Request(link.markdown_url))
    expect(second.status).toBe(410)

    // 5. "Delete that draft." Then the refresh: exchange the refresh token, and list again.
    const deleted = await call(token, 'delete_draft', { id: draft.id }, 6)
    expect(deleted.isError).not.toBe(true)

    const refreshed = await route(
      new Request(`${APP_URL}/api/oauth/token`, {
        method: 'POST',
        headers: FORM,
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: pair.refresh_token,
          client_id: 'xtc_mcp_test'
        }).toString()
      })
    )
    expect(refreshed.status).toBe(200)
    token = (await refreshed.json()).access_token

    const after = await call(token, 'list_drafts', { published: false }, 7)
    expect(after.isError).not.toBe(true)
    expect(after.structuredContent.drafts).toEqual([])
  })
})
