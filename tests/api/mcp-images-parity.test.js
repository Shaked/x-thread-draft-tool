// @vitest-environment node
// #367 part (b): the editor's image features on MCP (list, add at a place, replace, move, remove all).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({
  putBlob: vi.fn(async (pathname) => ({ url: `https://store.public.blob.vercel-storage.com/${pathname}` })),
  deleteBlobUrls: vi.fn(async () => {})
}))

import { deleteBlobUrls, putBlob } from '../../server/blob.js'
import { route } from '../../server/router.js'
import { issuePair } from '../../server/oauth/tokens.js'
import { setResolverForTests } from '../../server/remote-image.js'
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
  setResolverForTests(async () => [{ address: '93.184.216.34', family: 4 }])
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } })))
  return () => {
    setResolverForTests(null)
    vi.unstubAllGlobals()
  }
})

async function tool(name, args) {
  id += 1
  const body = { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: `Bearer ${token}` }
  const { result } = await (await route(new Request(MCP, { method: 'POST', headers, body: JSON.stringify(body) }))).json()
  return { error: result.isError ? result.content[0].text : null, data: result.structuredContent }
}

/** An image url under alice's own Blob folder, so remove and replace may delete its file. */
const own = (name) => `https://store.public.blob.vercel-storage.com/drafts/${alice.id}/d/${name}.png`
const post = (postId, names) => ({ id: postId, text: postId, images: names.map((name) => ({ url: own(name) })), embeddedTweet: null })
const urlsOf = async (draftId) => (await db.pg.query('select posts from drafts where id = $1', [draftId])).rows[0].posts.map((p) => p.images.map((i) => i.url))

describe('list what exists', () => {
  it('get_draft_outline gives each post its image urls in order', async () => {
    const draft = await db.insertDraft(alice.id, { posts: [post('p1', ['a', 'b']), post('p2', [])] })
    const { data } = await tool('get_draft_outline', { id: draft.id })
    expect(data.draft.posts.map((p) => [p.image_count, p.images])).toEqual([[2, [own('a'), own('b')]], [0, []]])
  })
})

describe('add_image_from_url', () => {
  it('puts the image at position, and refuses a position past the end before any upload', async () => {
    const draft = await db.insertDraft(alice.id, { posts: [post('p1', ['a', 'b'])] })
    const added = await tool('add_image_from_url', { draftId: draft.id, url: 'https://example.com/n.png', postId: 'p1', position: 1 })
    expect(added.error).toBeNull()
    expect((await urlsOf(draft.id))[0]).toEqual([added.data.url, own('a'), own('b')])
    const late = await tool('add_image_from_url', { draftId: draft.id, url: 'https://example.com/m.png', postId: 'p1', position: 5 })
    expect(late.error).toMatch(/position must be from 1 to 4/)
    expect(putBlob).toHaveBeenCalledTimes(1)
  })

  it('names the full post and what to do, and refuses a published draft, both before any upload', async () => {
    const full = await db.insertDraft(alice.id, { posts: [post('p1', []), post('p2', ['a', 'b', 'c', 'd'])] })
    expect((await tool('add_image_from_url', { draftId: full.id, url: 'https://example.com/n.png', postId: 'p2' })).error).toMatch(/Post 2 already has 4 images\. Remove, replace or move one first/)
    const published = await db.insertDraft(alice.id, { is_published: true, published_at: new Date().toISOString() })
    expect((await tool('add_image_from_url', { draftId: published.id, url: 'https://example.com/n.png', postId: 'p1' })).error).toMatch(/published/)
    expect(putBlob).not.toHaveBeenCalled()
  })

  it('replace: the new image takes the old one\'s post and place, and the old file is deleted', async () => {
    const draft = await db.insertDraft(alice.id, { posts: [post('p1', ['a']), post('p2', ['b', 'c'])] })
    const res = await tool('add_image_from_url', { draftId: draft.id, url: 'https://example.com/n.png', replace: own('b') })
    expect(res.error).toBeNull()
    expect(await urlsOf(draft.id)).toEqual([[own('a')], [res.data.image_url, own('c')]])
    expect(deleteBlobUrls).toHaveBeenCalledWith([own('b')])
  })

  it('replace: an unknown image is refused before any upload; a stale version writes nothing and deletes the new file', async () => {
    const draft = await db.insertDraft(alice.id, { posts: [post('p1', ['a'])] })
    expect((await tool('add_image_from_url', { draftId: draft.id, url: 'https://example.com/n.png', replace: own('zz') })).error).toMatch(/Image not found/)
    expect(putBlob).not.toHaveBeenCalled()
    const stale = await tool('add_image_from_url', { draftId: draft.id, url: 'https://example.com/n.png', replace: own('a'), version: draft.version + 5 })
    expect(stale.error).toMatch(/changed since you read it/)
    expect(await urlsOf(draft.id)).toEqual([[own('a')]])
    expect(deleteBlobUrls).toHaveBeenCalledTimes(1)
    expect(deleteBlobUrls.mock.calls[0][0][0]).not.toBe(own('a'))
  })
})

describe('move_post with image_url', () => {
  it('reorders an image in its post and moves one to another post', async () => {
    const draft = await db.insertDraft(alice.id, { posts: [post('p1', ['a', 'b', 'c']), post('p2', ['d'])] })
    expect((await tool('move_post', { id: draft.id, image_url: own('c'), post_id: 'p1', position: 1 })).error).toBeNull()
    expect((await urlsOf(draft.id))[0]).toEqual([own('c'), own('a'), own('b')])
    expect((await tool('move_post', { id: draft.id, image_url: own('a'), post_id: 'p2', position: 2 })).error).toBeNull()
    expect(await urlsOf(draft.id)).toEqual([[own('c'), own('b')], [own('d'), own('a')]])
    expect(deleteBlobUrls).not.toHaveBeenCalled()
  })

  it('refuses a full target post, an unknown image and a stale version', async () => {
    const draft = await db.insertDraft(alice.id, { posts: [post('p1', ['a']), post('p2', ['b', 'c', 'd', 'e'])] })
    expect((await tool('move_post', { id: draft.id, image_url: own('a'), post_id: 'p2', position: 1 })).error).toMatch(/Post 2 already has 4 images/)
    expect((await tool('move_post', { id: draft.id, image_url: own('zz'), post_id: 'p2', position: 1 })).error).toMatch(/Image not found/)
    expect((await tool('move_post', { id: draft.id, image_url: own('b'), post_id: 'p2', position: 4, version: draft.version + 5 })).error).toMatch(/changed since you read it/)
    expect(await urlsOf(draft.id)).toEqual([[own('a')], [own('b'), own('c'), own('d'), own('e')]])
  })
})

describe('remove_image', () => {
  it('with post_id removes every image of that post only, and deletes the unused files', async () => {
    const draft = await db.insertDraft(alice.id, { posts: [post('p1', ['a', 'b']), post('p2', ['c'])] })
    const res = await tool('remove_image', { draftId: draft.id, post_id: 'p1' })
    expect(res.error).toBeNull()
    expect(res.data).toMatchObject({ removed: 2, deleted: 2 })
    expect(await urlsOf(draft.id)).toEqual([[], [own('c')]])
  })

  it('needs exactly one of url and post_id, and refuses a stale version', async () => {
    const draft = await db.insertDraft(alice.id, { posts: [post('p1', ['a'])] })
    expect((await tool('remove_image', { draftId: draft.id })).error).toMatch(/Give url/)
    expect((await tool('remove_image', { draftId: draft.id, url: own('a'), post_id: 'p1' })).error).toMatch(/Give url/)
    expect((await tool('remove_image', { draftId: draft.id, url: own('a'), version: draft.version + 5 })).error).toMatch(/changed since you read it/)
    expect(await urlsOf(draft.id)).toEqual([[own('a')]])
    expect(deleteBlobUrls).not.toHaveBeenCalled()
  })
})
