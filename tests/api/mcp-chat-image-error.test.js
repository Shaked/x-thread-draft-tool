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

// #415 follow-up: the scheme check uses the same parser as the server fetch. What it accepts reaches the server, which refuses
// these private or credential forms before any fetch, so no network is used. The spy proves that.
describe('add_image_from_url: the url parser and the next step (#415 follow-up)', () => {
  it.each([
    ['a leading space', ' https://127.0.0.1/a.png'],
    ['a leading tab', '\thttps://127.0.0.1/a.png'],
    ['https: with no slashes', 'https:127.0.0.1/a.png'],
    ['backslashes for slashes', 'https:\\\\127.0.0.1\\a.png']
  ])('%s is an http(s) URL: the server refuses the private address, no chat-only error, no fetch', async (_, url) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    try {
      const draft = await db.insertDraft(alice.id, { posts: [post('p1')] })
      const out = await tool('add_image_from_url', { draftId: draft.id, postId: 'p1', url })
      expect(out.error).toMatch(/not allowed/)
      expect(out.error).not.toContain('That is not a public image URL')
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(putBlob).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('credentials stay refused by the server, with no chat-only error and no fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    try {
      const draft = await db.insertDraft(alice.id, { posts: [post('p1')] })
      const out = await tool('add_image_from_url', { draftId: draft.id, postId: 'p1', url: 'https://user:pass@127.0.0.1/a.png' })
      expect(out.error).toMatch(/credentials are not allowed/)
      expect(out.error).not.toContain('That is not a public image URL')
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it.each([
    ['ftp', 'ftp://example.com/a.png'],
    ['file', 'file:///mnt/data/photo.png'],
    ['javascript', 'javascript:alert(1)'],
    ['blob', 'blob:https://example.com/3f2a'],
    ['data', 'data:image/png;base64,iVBORw0KGgo=']
  ])('%s is not http(s): the chat-only error, nothing uploaded', async (_, url) => {
    const draft = await db.insertDraft(alice.id, { posts: [post('p1')] })
    const out = await tool('add_image_from_url', { draftId: draft.id, postId: 'p1', url })
    expect(out.error).toContain('That is not a public image URL')
    expect(out.error).toContain('add the image to post 1')
    expect(putBlob).not.toHaveBeenCalled()
  })

  it('without postId the editor link is built from a draft the caller owns: another user\'s draft is not found', async () => {
    const bob = await db.insertUser({ github_id: 2, login: 'bob' })
    const theirs = await db.insertDraft(bob.id, { posts: [post('p1')] })
    const out = await tool('add_image_from_url', { draftId: theirs.id, url: 'data:image/png;base64,iVBORw0KGgo=' })
    expect(out.error).toMatch(/not found/i)
    expect(out.error).not.toContain(`/draft/${theirs.id}`)
    expect(putBlob).not.toHaveBeenCalled()
  })

  it('with postId the next step says "and no url" for the upload link', async () => {
    const draft = await db.insertDraft(alice.id, { posts: [post('p1')] })
    const out = await tool('add_image_from_url', { draftId: draft.id, postId: 'p1', url: '/mnt/data/photo.png' })
    expect(out.error).toContain('call this tool with the same draftId and postId and upload_link: true and no url')
  })

  it('with replace, a chat-only image gets no upload link: an upload link cannot replace an image', async () => {
    const draft = await db.insertDraft(alice.id, { posts: [post('p1')] })
    const out = await tool('add_image_from_url', { draftId: draft.id, url: 'photo.png', replace: 'https://store.public.blob.vercel-storage.com/old.png' })
    expect(out.error).toContain('That is not a public image URL')
    expect(out.error).toContain('An upload link cannot replace an image')
    expect(out.error).not.toContain('upload_link')
    expect(out.error).toContain(`/draft/${draft.id}`)
    expect(putBlob).not.toHaveBeenCalled()
  })
})
