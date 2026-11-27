// @vitest-environment node
// #418: add_image_from_url with upload_link makes the one-time upload link; the same REST function as the route.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { route } from '../../server/router.js'
import { issuePair } from '../../server/oauth/tokens.js'
import { APP_URL, setupTestDb } from './helpers/db.js'

const MCP = `${APP_URL}/api/mcp`
let db
let alice
let token
let id = 0

beforeAll(async () => {
  db = await setupTestDb()
})

beforeEach(async () => {
  await db.reset()
  vi.clearAllMocks()
  await db.pg.query("insert into oauth_clients (client_id, kind, client_name) values ('xtc_mcp_test', 'registered', 'Test') on conflict do nothing")
  alice = await db.insertUser({ github_id: 1, login: 'alice' })
  const { rows } = await db.pg.query(
    "insert into oauth_grants (user_id, client_id, scope, resource) values ($1, 'xtc_mcp_test', 'drafts', $2) returning id",
    [alice.id, MCP]
  )
  token = (await issuePair(rows[0].id)).access_token
})

async function tool(name, args) {
  id += 1
  const body = { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: `Bearer ${token}` }
  const { result } = await (await route(new Request(MCP, { method: 'POST', headers, body: JSON.stringify(body) }))).json()
  return { error: result.isError ? result.content[0].text : null, data: result.structuredContent, text: result.content[1]?.text, parts: result.content.map((part) => part.text) }
}

describe('add_image_from_url with upload_link', () => {
  it('makes a link for the post and says what to do next, without a url argument', async () => {
    const draft = await db.insertDraft(alice.id)
    const out = await tool('add_image_from_url', { draftId: draft.id, postId: 'p1', upload_link: true })
    expect(out.error).toBeNull()
    expect(out.data.upload).toMatchObject({ post: 1, slots: 4 })
    expect(out.data.upload.link).toMatch(/\/upload#[A-Za-z0-9_-]{43}$/)
    expect(out.data.upload.note).toContain('Give this link to the user')
    expect(out.data.upload.note).toContain('get_draft_outline')
    expect(out.parts.join('\n')).toContain('Give the upload link to the user. When they say it is done, call get_draft_outline.')
    const { rows } = await db.pg.query('select slots, post_id from image_upload_links')
    expect(rows).toEqual([{ slots: 4, post_id: 'p1' }])
  })

  it('asks for postId and refuses url with the link', async () => {
    const draft = await db.insertDraft(alice.id)
    expect((await tool('add_image_from_url', { draftId: draft.id, upload_link: true })).error).toContain('upload_link needs postId')
    expect((await tool('add_image_from_url', { draftId: draft.id, postId: 'p1', upload_link: true, url: 'https://example.com/a.png' })).error).toContain('upload_link needs postId')
    expect((await tool('add_image_from_url', { draftId: draft.id })).error).toContain('upload_link: true')
  })

  it("refuses another user's draft and a missing post", async () => {
    const bob = await db.insertUser({ github_id: 2, login: 'bob' })
    const other = await db.insertDraft(bob.id)
    expect((await tool('add_image_from_url', { draftId: other.id, postId: 'p1', upload_link: true })).error).toMatch(/not found/i)
    const mine = await db.insertDraft(alice.id)
    expect((await tool('add_image_from_url', { draftId: mine.id, postId: 'zzz', upload_link: true })).error).toMatch(/not found/i)
  })
})
