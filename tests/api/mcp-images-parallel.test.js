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
import { APP_URL, apiRequest, setupTestDb } from './helpers/db.js'
import { exifPayload, jpegSegment, makeGif, makeJpeg, makePng, makeWebp, SVG } from './helpers/images.js'

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

let rpcId = 100
async function tool(name, args) {
  rpcId += 1
  const body = { jsonrpc: '2.0', id: rpcId, method: 'tools/call', params: { name, arguments: args } }
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: `Bearer ${token}` }
  const { result } = await (await route(new Request(MCP, { method: 'POST', headers, body: JSON.stringify(body) }))).json()
  return { error: result.isError ? result.content[0].text : null, data: result.structuredContent, parts: result.content.map((part) => part.text) }
}

const b64 = (bytes) => Buffer.from(bytes).toString('base64')
const post = (postId, n = 0) => ({ id: postId, text: postId, images: Array.from({ length: n }, (_, i) => ({ url: `https://store.public.blob.vercel-storage.com/drafts/${alice.id}/d/old${i}.png` })), embeddedTweet: null })
const postsOf = async (draftId) => (await db.pg.query('select posts from drafts where id = $1', [draftId])).rows[0].posts

// #419: the image bytes (data base64 + mime), same checks as POST /images.
describe('add_image_from_url with data and mime', () => {
  it.each([
    ['image/png', makePng(), '.png'],
    ['image/webp', makeWebp(), '.webp']
  ])('stores %s bytes and attaches them to the post', async (mime, bytes, ext) => {
    const draft = await db.insertDraft(alice.id, { posts: [post('p1')] })
    const res = await tool('add_image_from_url', { draftId: draft.id, postId: 'p1', data: b64(bytes), mime })
    expect(res.error).toBeNull()
    expect(res.data.url).toMatch(new RegExp(`/drafts/${alice.id}/${draft.id}/[0-9a-f-]+\\${ext}$`))
    expect(putBlob).toHaveBeenCalledTimes(1)
    expect(putBlob.mock.calls[0][2].contentType).toBe(mime)
    expect((await postsOf(draft.id))[0].images).toEqual([{ url: res.data.url }])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('without postId it only uploads, and gives the url', async () => {
    const draft = await db.insertDraft(alice.id, { posts: [post('p1')] })
    const res = await tool('add_image_from_url', { draftId: draft.id, data: b64(makeGif()), mime: 'image/gif' })
    expect(res.error).toBeNull()
    expect(res.data.url).toMatch(/\.gif$/)
    expect((await postsOf(draft.id))[0].images).toEqual([])
  })

  it('removes metadata like POST /images does', async () => {
    const draft = await db.insertDraft(alice.id, { posts: [post('p1')] })
    const jpeg = makeJpeg({ exif: jpegSegment(0xe1, exifPayload(6)) })
    const res = await tool('add_image_from_url', { draftId: draft.id, postId: 'p1', data: b64(jpeg), mime: 'image/jpeg' })
    expect(res.error).toBeNull()
    expect(Buffer.from(putBlob.mock.calls[0][1]).includes(Buffer.from('Exif'))).toBe(false)
  })

  it('replace puts the uploaded file where the old image was', async () => {
    const draft = await db.insertDraft(alice.id, { posts: [post('p1', 1)] })
    const old = (await postsOf(draft.id))[0].images[0].url
    const res = await tool('add_image_from_url', { draftId: draft.id, replace: old, data: b64(makePng()), mime: 'image/png' })
    expect(res.error).toBeNull()
    expect((await postsOf(draft.id))[0].images).toEqual([{ url: res.data.image_url }])
    expect(deleteBlobUrls).toHaveBeenCalledWith([old])
  })

  it('deletes the uploaded file again when the post is full', async () => {
    const draft = await db.insertDraft(alice.id, { posts: [post('p1', 4)] })
    const res = await tool('add_image_from_url', { draftId: draft.id, postId: 'p1', data: b64(makePng()), mime: 'image/png' })
    expect(res.error).toMatch(/already has 4 images/)
    expect(putBlob).toHaveBeenCalledTimes(1)
    const stored = putBlob.mock.results.length ? (await putBlob.mock.results[0].value).url : null
    expect(deleteBlobUrls).toHaveBeenCalledWith([stored])
    expect((await postsOf(draft.id))[0].images).toHaveLength(4)
  })

  it('refuses more than 933,336 characters before decoding, with no upload', async () => {
    const draft = await db.insertDraft(alice.id, { posts: [post('p1')] })
    const decode = vi.spyOn(Buffer, 'from')
    const res = await tool('add_image_from_url', { draftId: draft.id, postId: 'p1', data: 'A'.repeat(933_340), mime: 'image/png' })
    expect(res.error).toMatch(/over 700,000 bytes/)
    expect(res.error).toMatch(/POST \/images/)
    expect(decode.mock.calls.some(([value]) => typeof value === 'string' && value.length > 933_336)).toBe(false)
    decode.mockRestore()
    expect(putBlob).not.toHaveBeenCalled()
  })

  it('accepts exactly 933,336 characters of size (a bad image is then refused by type, not size)', async () => {
    const draft = await db.insertDraft(alice.id, { posts: [post('p1')] })
    const res = await tool('add_image_from_url', { draftId: draft.id, postId: 'p1', data: 'A'.repeat(933_336), mime: 'image/png' })
    expect(res.error).not.toMatch(/over 700,000 bytes/)
    expect(putBlob).not.toHaveBeenCalled()
  })

  it.each([['not base64!!', 'bad characters'], ['abc', 'bad length'], ['', 'empty']])('refuses bad base64 (%s: %s) with no upload', async (data) => {
    const draft = await db.insertDraft(alice.id, { posts: [post('p1')] })
    const res = await tool('add_image_from_url', { draftId: draft.id, postId: 'p1', data, mime: 'image/png' })
    expect(res.error).toMatch(/not valid base64/)
    expect(putBlob).not.toHaveBeenCalled()
  })

  it('refuses url together with data, upload_link with data, and data without mime', async () => {
    const draft = await db.insertDraft(alice.id, { posts: [post('p1')] })
    const data = b64(makePng())
    expect((await tool('add_image_from_url', { draftId: draft.id, postId: 'p1', data, mime: 'image/png', url: 'https://example.com/a.png' })).error).toMatch(/data or url, not both/)
    expect((await tool('add_image_from_url', { draftId: draft.id, postId: 'p1', data, mime: 'image/png', upload_link: true })).error).toMatch(/data or url, not both/)
    expect((await tool('add_image_from_url', { draftId: draft.id, postId: 'p1', data })).error).toMatch(/needs mime/)
    expect((await tool('add_image_from_url', { draftId: draft.id, postId: 'p1', url: 'https://example.com/a.png', mime: 'image/png' })).error).toMatch(/mime goes with data/)
    expect(putBlob).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses a wrong mime, SVG and other bytes, and an unlisted mime, with no upload', async () => {
    const draft = await db.insertDraft(alice.id, { posts: [post('p1')] })
    expect((await tool('add_image_from_url', { draftId: draft.id, postId: 'p1', data: b64(makePng()), mime: 'image/jpeg' })).error).toMatch(/mime says image\/jpeg but the bytes are image\/png/)
    expect((await tool('add_image_from_url', { draftId: draft.id, postId: 'p1', data: b64(SVG), mime: 'image/png' })).error).toMatch(/not a supported image/)
    expect((await tool('add_image_from_url', { draftId: draft.id, postId: 'p1', data: b64(makePng()), mime: 'image/svg+xml' })).error).toBeTruthy()
    expect(putBlob).not.toHaveBeenCalled()
  })

  it("refuses another user's draft with no upload", async () => {
    const bob = await db.insertUser({ github_id: 2, login: 'bob' })
    const draft = await db.insertDraft(bob.id, { posts: [post('p1')] })
    const res = await tool('add_image_from_url', { draftId: draft.id, postId: 'p1', data: b64(makePng()), mime: 'image/png' })
    expect(res.error).toMatch(/not found/i)
    expect(putBlob).not.toHaveBeenCalled()
  })

  it('refuses data and mime of the wrong type with no upload', async () => {
    const draft = await db.insertDraft(alice.id, { posts: [post('p1')] })
    expect((await tool('add_image_from_url', { draftId: draft.id, postId: 'p1', data: 1234, mime: 'image/png' })).error).toBeTruthy()
    expect((await tool('add_image_from_url', { draftId: draft.id, postId: 'p1', data: ['A'.repeat(933_340)], mime: 'image/png' })).error).toBeTruthy()
    expect((await tool('add_image_from_url', { draftId: draft.id, postId: 'p1', data: b64(makePng()), mime: 42 })).error).toBeTruthy()
    expect(putBlob).not.toHaveBeenCalled()
  })

  it('replace with a stale version deletes the uploaded file and never fetches', async () => {
    const draft = await db.insertDraft(alice.id, { posts: [post('p1', 1)] })
    const old = (await postsOf(draft.id))[0].images[0].url
    const res = await tool('add_image_from_url', { draftId: draft.id, replace: old, version: 99, data: b64(makePng()), mime: 'image/png' })
    expect(res.error).toBeTruthy()
    expect(putBlob).toHaveBeenCalledTimes(1)
    expect(deleteBlobUrls).toHaveBeenCalledWith([(await putBlob.mock.results[0].value).url])
    expect((await postsOf(draft.id))[0].images).toEqual([{ url: old }])
    expect(fetch).not.toHaveBeenCalled()
  })
})

// #419: POST /drafts/:id/images attaches without a fetch only a file this process just stored for the caller.
describe('POST /drafts/:id/images and files stored by POST /images', () => {
  const attach = (cookie, draftId, url) => route(apiRequest(`/api/drafts/${draftId}/images`, { method: 'POST', cookie, body: { url, post_id: 'p1' } }))
  const upload = async (cookie, draftId) => (await (await route(apiRequest(`/api/images?draftId=${draftId}`, { method: 'POST', cookie, headers: { 'content-type': 'image/png' }, body: makePng() }))).json()).url

  it('attaches a just uploaded file as it is, once: no fetch', async () => {
    const cookie = await db.cookieFor(alice)
    const draft = await db.insertDraft(alice.id, { posts: [post('p1')] })
    const url = await upload(cookie, draft.id)
    expect((await attach(cookie, draft.id, url)).status).toBe(200)
    expect(fetch).not.toHaveBeenCalled()
    expect((await postsOf(draft.id))[0].images).toEqual([{ url }])
  })

  it('does not delete that file when the edit fails (the caller owns it)', async () => {
    const cookie = await db.cookieFor(alice)
    const draft = await db.insertDraft(alice.id, { posts: [post('p1', 4)] })
    const url = await upload(cookie, draft.id)
    expect((await attach(cookie, draft.id, url)).status).toBe(422)
    expect(deleteBlobUrls).not.toHaveBeenCalled()
  })

  it('fetches a url of another Blob store even under the caller\'s own prefix', async () => {
    const cookie = await db.cookieFor(alice)
    const draft = await db.insertDraft(alice.id, { posts: [post('p1')] })
    await attach(cookie, draft.id, `https://other-store.public.blob.vercel-storage.com/drafts/${alice.id}/d/x.png`)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('fetches a url of this store that this process did not just store', async () => {
    const cookie = await db.cookieFor(alice)
    const draft = await db.insertDraft(alice.id, { posts: [post('p1')] })
    await attach(cookie, draft.id, `https://store.public.blob.vercel-storage.com/drafts/${alice.id}/d/never-stored.png`)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
