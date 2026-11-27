// @vitest-environment node
// #419: add_image_from_url takes the image bytes (data base64 + mime), with the same checks as POST /images.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({
  putBlob: vi.fn(async (pathname) => ({ url: `https://store.public.blob.vercel-storage.com/${pathname}` })),
  deleteBlobUrls: vi.fn(async () => {})
}))

import { deleteBlobUrls, putBlob } from '../../server/blob.js'
import { route } from '../../server/router.js'
import { issuePair } from '../../server/oauth/tokens.js'
import { APP_URL, setupTestDb } from './helpers/db.js'
import { exifPayload, jpegSegment, makeGif, makeJpeg, makePng, makeWebp, SVG } from './helpers/images.js'

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
  const fetchSpy = vi.fn()
  vi.stubGlobal('fetch', fetchSpy)
  return () => vi.unstubAllGlobals()
})

async function tool(name, args) {
  id += 1
  const body = { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: `Bearer ${token}` }
  const { result } = await (await route(new Request(MCP, { method: 'POST', headers, body: JSON.stringify(body) }))).json()
  return { error: result.isError ? result.content[0].text : null, data: result.structuredContent, parts: result.content.map((part) => part.text) }
}

const b64 = (bytes) => Buffer.from(bytes).toString('base64')
const post = (postId, n = 0) => ({ id: postId, text: postId, images: Array.from({ length: n }, (_, i) => ({ url: `https://store.public.blob.vercel-storage.com/drafts/${alice.id}/d/old${i}.png` })), embeddedTweet: null })
const postsOf = async (draftId) => (await db.pg.query('select posts from drafts where id = $1', [draftId])).rows[0].posts

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
})
