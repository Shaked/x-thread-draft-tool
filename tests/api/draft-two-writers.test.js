// @vitest-environment node
// #354 (epic #273, L1 a): two writers on one draft. The open editor loaded version R, an AI app
// changed the draft through MCP (R+1), then the editor saves. The editor's request is the one
// src/utils/api.js sends today: the whole title and posts, no If-Match. Real route(), real SQL (PGlite).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({ putBlob: vi.fn(), deleteBlobUrls: vi.fn(async () => {}) }))
import * as router from '../../server/router.js'
import { callTool } from '../../server/mcp/tools.js'
import { apiRequest, setupTestDb } from './helpers/db.js'

const POSTS = () => [
  { id: 'a', text: 'post A', images: [{ url: 'https://blob.test/a.png' }], embeddedTweet: null },
  { id: 'b', text: 'post B', images: [], embeddedTweet: null }
]

let db
let alice
let cookie

beforeAll(async () => {
  db = await setupTestDb()
})

beforeEach(async () => {
  vi.restoreAllMocks()
  await db.reset()
  alice = await db.insertUser({ github_id: 1, login: 'alice' })
  cookie = await db.cookieFor(alice)
})

const ai = (name, args) => callTool(name, args, { caller: { uid: alice.id, via: 'oauth', clientName: 'Test client' }, origin: 'https://app.test' })
const editorLoads = async (id) => (await (await router.route(apiRequest(`/api/drafts/${id}`, { cookie }))).json()).draft
const editorSaves = (id, copy, ifMatch) =>
  router.route(
    apiRequest(`/api/drafts/${id}`, {
      method: 'PATCH',
      body: { title: copy.title, posts: copy.posts },
      cookie,
      headers: ifMatch === undefined ? {} : { 'if-match': ifMatch }
    })
  )
const stored = async (id) => (await db.pg.query('select title, posts, version from drafts where id = $1', [id])).rows[0]
const texts = (row) => row.posts.map((post) => post.text)

describe('the lost update (#354)', () => {
  it('a save without a revision is last-write-wins: the editor copy from R removes the AI edit made at R+1', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    const copy = await editorLoads(draft.id) // R = 1
    expect((await ai('update_post', { id: draft.id, post_id: 'b', text: 'post B by AI' })).isError).toBe(false)
    expect(texts(await stored(draft.id))).toEqual(['post A', 'post B by AI']) // R+1 = 2

    copy.posts[0] = { ...copy.posts[0], text: 'post A edited' } // the user types in post A
    expect((await editorSaves(draft.id, copy)).status).toBe(200)
    // The REST contract for a client that sends no revision; the editor sends one from #273 L1 (c).
    expect(await stored(draft.id)).toMatchObject({ version: 3, posts: [{ text: 'post A edited' }, { text: 'post B' }] })
  })

  it('the same save with the revision it loaded is 412: nothing written, the answer has the current draft', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    const copy = await editorLoads(draft.id)
    await ai('update_post', { id: draft.id, post_id: 'b', text: 'post B by AI' })
    const before = await stored(draft.id)

    copy.posts[0] = { ...copy.posts[0], text: 'post A edited' }
    const res = await editorSaves(draft.id, copy, `"${copy.version}"`)
    expect(res.status).toBe(412)
    expect(res.headers.get('etag')).toBe('"2"')
    const body = await res.json()
    expect(body.version).toBe(2)
    expect(body.draft).toMatchObject({ id: draft.id, version: 2, posts: [{ text: 'post A' }, { text: 'post B by AI' }] })
    expect(await stored(draft.id)).toEqual(before)
  })

  it('the save with the current revision writes and returns the next one', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    await ai('update_post', { id: draft.id, post_id: 'b', text: 'post B by AI' })
    const copy = await editorLoads(draft.id)
    copy.posts[0] = { ...copy.posts[0], text: 'post A edited' }
    const res = await editorSaves(draft.id, copy, `"${copy.version}"`)
    expect(res.status).toBe(200)
    expect((await res.json()).draft.version).toBe(3)
    expect(texts(await stored(draft.id))).toEqual(['post A edited', 'post B by AI'])
  })

  it('two writers on different posts with the per-post route keep both edits', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    await ai('update_post', { id: draft.id, post_id: 'b', text: 'post B by AI' })
    const res = await router.route(apiRequest(`/api/drafts/${draft.id}/posts/a`, { method: 'PATCH', body: { text: 'post A edited' }, cookie }))
    expect(res.status).toBe(200)
    const row = await stored(draft.id)
    expect(row).toMatchObject({ version: 3, posts: [{ text: 'post A edited', images: [{ url: 'https://blob.test/a.png' }] }, { text: 'post B by AI' }] })
  })
})

describe('MCP tools follow the same revision rule', () => {
  it('update_draft with a stale version is refused, writes nothing and says to re-read; no post text in the answer', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    await editorSaves(draft.id, { title: 'by the user', posts: POSTS() }) // version 2
    const before = await stored(draft.id)
    const result = await ai('update_draft', { id: draft.id, title: 'by AI', version: 1 })
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toEqual({ error: expect.stringMatching(/get_draft/), version: 2 })
    expect(await stored(draft.id)).toEqual(before)
  })

  it('update_draft with the current version writes; the result has the new version', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    const result = await ai('update_draft', { id: draft.id, title: 'by AI', version: 1 })
    expect(result.isError).toBe(false)
    expect(result.structuredContent.draft.version).toBe(2)
    expect((await stored(draft.id)).title).toBe('by AI')
  })

  it('update_post with a stale version answers with the version only, not the post text', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    await editorSaves(draft.id, { title: 'by the user', posts: POSTS() }) // version 2
    const result = await ai('update_post', { id: draft.id, post_id: 'b', text: 'post B by AI', version: 1 })
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toEqual({ error: expect.stringMatching(/get_draft/), version: 2 })
    expect(texts(await stored(draft.id))).toEqual(['post A', 'post B'])
  })

  it('remove_image with the version it was given: an editor save after that read is kept, nothing is removed', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    await editorSaves(draft.id, { title: 'by the user', posts: POSTS() }) // version 2
    const result = await ai('remove_image', { draftId: draft.id, url: 'https://blob.test/a.png', version: 1 })
    expect(result.isError).toBe(true)
    expect(result.structuredContent.version).toBe(2)
    expect(await stored(draft.id)).toMatchObject({ title: 'by the user', version: 2, posts: [{ images: [{ url: 'https://blob.test/a.png' }] }, {}] })
  })
})
