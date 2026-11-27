// @vitest-environment node
// #367: an assistant that adds several images at once calls add_image_from_url in parallel.
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
import { makePng } from './helpers/images.js'

const MCP = `${APP_URL}/api/mcp`
let db
let alice
let token

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
  vi.stubGlobal('fetch', vi.fn(async () => new Response(makePng(), { headers: { 'content-type': 'image/png' } })))
  return () => {
    setResolverForTests(null)
    vi.unstubAllGlobals()
  }
})

async function addImage(draftId, n, postId = 'p1') {
  const body = { jsonrpc: '2.0', id: n, method: 'tools/call', params: { name: 'add_image_from_url', arguments: { draftId, url: `https://example.com/${n}.png`, ...(postId === null ? {} : { postId }) } } }
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: `Bearer ${token}` }
  const res = await route(new Request(MCP, { method: 'POST', headers, body: JSON.stringify(body) }))
  return (await res.json()).result
}

const imagesOf = async (draftId, i = 0) => (await db.pg.query('select posts from drafts where id = $1', [draftId])).rows[0].posts[i].images

describe('add_image_from_url called in parallel for one post', () => {
  it('adds all four images, none is refused as a stale write', async () => {
    const draft = await db.insertDraft(alice.id)
    const results = await Promise.all([1, 2, 3, 4].map((n) => addImage(draft.id, n)))
    expect(results.map((r) => r.isError)).toEqual([false, false, false, false])
    // #405: the thread view's "Open in editor" link is the draft's url; the top-level url is the image's.
    expect(results[0].structuredContent.draft.url).toBe(`${APP_URL}/draft/${draft.id}`)
    const stored = await imagesOf(draft.id)
    expect(new Set(stored.map((image) => image.url))).toEqual(new Set(results.map((r) => r.structuredContent.url)))
    expect(deleteBlobUrls).not.toHaveBeenCalled()
  })

  it('without postId: no post changes; the view gets the posts and the editor link, the text says so (#405)', async () => {
    const draft = await db.insertDraft(alice.id)
    const result = await addImage(draft.id, 1, null)
    expect(result._meta['x-thread/posts']).toEqual(await (await db.pg.query('select posts from drafts where id = $1', [draft.id])).rows[0].posts)
    expect(result.structuredContent.draft.url).toBe(`${APP_URL}/draft/${draft.id}`)
    expect(result.content.at(-2).text).toMatch(/^Uploaded, not in a post yet: draft version 1,/)
  })

  it('a fifth parallel call gets the 4-images error and its uploaded file is deleted', async () => {
    const draft = await db.insertDraft(alice.id)
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => addImage(draft.id, n)))
    const failed = results.filter((r) => r.isError)
    expect(failed).toHaveLength(1)
    expect(failed[0].content[0].text).toMatch(/already has 4 images/)
    expect(await imagesOf(draft.id)).toHaveLength(4)
    expect(putBlob).toHaveBeenCalledTimes(5)
    expect(deleteBlobUrls).toHaveBeenCalledTimes(1)
    const kept = new Set((await imagesOf(draft.id)).map((image) => image.url))
    expect(kept.has(deleteBlobUrls.mock.calls[0][0][0])).toBe(false)
  })

  it('four images each on two posts, all in parallel: all eight land (the version is per draft)', async () => {
    const posts = ['p1', 'p2'].map((id) => ({ id, text: id, images: [], embeddedTweet: null }))
    const draft = await db.insertDraft(alice.id, { posts })
    const results = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map((n) => addImage(draft.id, n, n <= 4 ? 'p1' : 'p2')))
    expect(results.filter((r) => r.isError)).toEqual([])
    expect(await imagesOf(draft.id, 0)).toHaveLength(4)
    expect(await imagesOf(draft.id, 1)).toHaveLength(4)
  })
})
