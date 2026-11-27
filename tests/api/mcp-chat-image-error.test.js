// @vitest-environment node
// #415: a chat-only image (a data: URL, a file path, an attachment name) gets the next step that exists, and no upload is made.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({
  putBlob: vi.fn(async (pathname) => ({ url: `https://store.public.blob.vercel-storage.com/${pathname}` })),
  deleteBlobUrls: vi.fn(async () => {})
}))

import { putBlob } from '../../server/blob.js'
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
  return { error: result.isError ? result.content[0].text : null, data: result.structuredContent }
}

const post = (postId) => ({ id: postId, text: postId, images: [], embeddedTweet: null })

describe('add_image_from_url with a chat-only image', () => {
  it.each([
    ['a data: URL', 'data:image/png;base64,iVBORw0KGgo='],
    ['a file path', '/mnt/data/photo.png'],
    ['an attachment name', 'photo.png']
  ])('%s: names the upload link first and the editor link and post number, and uploads nothing', async (_, url) => {
    const draft = await db.insertDraft(alice.id, { posts: [post('p1'), post('p2')] })
    const out = await tool('add_image_from_url', { draftId: draft.id, postId: 'p2', url })
    expect(out.error).toContain('That is not a public image URL')
    expect(out.error).toContain('upload_link: true')
    expect(out.error).toContain(`/draft/${draft.id}`)
    expect(out.error).toContain('add the image to post 2')
    expect(putBlob).not.toHaveBeenCalled()
    const { rows } = await db.pg.query('select count(*)::int as n from image_upload_links')
    expect(rows[0].n).toBe(0)
  })

  it('without postId: names the editor link and "the post", and says how to get an upload link', async () => {
    const draft = await db.insertDraft(alice.id, { posts: [post('p1')] })
    const out = await tool('add_image_from_url', { draftId: draft.id, url: 'data:image/png;base64,iVBORw0KGgo=' })
    expect(out.error).toContain(`/draft/${draft.id}`)
    expect(out.error).toContain('add the image to the post')
    expect(out.error).toContain('call this tool with postId and upload_link: true')
    expect(putBlob).not.toHaveBeenCalled()
  })

  it('a post id the draft does not have still gets the editor link, with "the post"', async () => {
    const draft = await db.insertDraft(alice.id, { posts: [post('p1')] })
    const out = await tool('add_image_from_url', { draftId: draft.id, postId: 'nope', url: '/mnt/data/photo.png' })
    expect(out.error).toContain('add the image to the post (drag, paste or click)')
    expect(putBlob).not.toHaveBeenCalled()
  })
})
