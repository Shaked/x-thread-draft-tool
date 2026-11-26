// @vitest-environment node
// Plan O1 part 2: the whole-draft PATCH and publish are one transaction on a locked row, honour
// If-Match (RFC 9110: `*`, strong tags only, malformed is 400), and a replay writes nothing. The MCP
// post tools call one route each (#412), which checks the version it read when it writes. Real route(), real SQL (PGlite).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({ putBlob: vi.fn(), deleteBlobUrls: vi.fn(async () => {}) }))
import * as router from '../../server/router.js'
import { deleteBlobUrls } from '../../server/blob.js'
import { callTool } from '../../server/mcp/tools.js'
import { setQueryImpl } from '../../server/db.js'
import { apiRequest, setupTestDb } from './helpers/db.js'

const route = (request) => router.route(request)

const POSTS = () => [
  { id: 'a', text: 'first', images: [], embeddedTweet: null },
  { id: 'b', text: 'second', images: [], embeddedTweet: null }
]

let db
let alice
let aliceCookie
let failOn = null
/** Set by a test: runs once, awaited, before the next post write (a second writer landing between read and write). */
let beforePostWrite = null

beforeAll(async () => {
  db = await setupTestDb()
  setQueryImpl(async (text, params = []) => {
    if (failOn?.(text)) throw new Error('injected failure')
    if (beforePostWrite && text.startsWith('update drafts set posts')) {
      const hook = beforePostWrite
      beforePostWrite = null
      await hook()
    }
    const result = await db.pg.query(text, params)
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length }
  })
})

beforeEach(async () => {
  failOn = null
  beforePostWrite = null
  vi.restoreAllMocks()
  await db.reset()
  alice = await db.insertUser({ github_id: 1, login: 'alice' })
  aliceCookie = await db.cookieFor(alice)
})

const rowOf = async (id) =>
  (await db.pg.query('select title, posts, version, updated_at, is_published, published_at from drafts where id = $1', [id])).rows[0]

const patchDraft = (id, body, ifMatch) =>
  route(apiRequest(`/api/drafts/${id}`, { method: 'PATCH', body, cookie: aliceCookie, headers: ifMatch === undefined ? {} : { 'if-match': ifMatch } }))
const publish = (id, ifMatch) =>
  route(apiRequest(`/api/drafts/${id}/publish`, { method: 'POST', cookie: aliceCookie, headers: ifMatch === undefined ? {} : { 'if-match': ifMatch } }))
const patchPost = (id, postId, body, ifMatch) =>
  route(apiRequest(`/api/drafts/${id}/posts/${postId}`, { method: 'PATCH', body, cookie: aliceCookie, headers: ifMatch === undefined ? {} : { 'if-match': ifMatch } }))

describe('PATCH /api/drafts/:id', () => {
  it('writes, bumps version and sends an ETag; GET sends the same ETag', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    const res = await patchDraft(draft.id, { title: 'New' }, '"1"')
    expect(res.status).toBe(200)
    expect((await res.json()).draft.version).toBe(2)
    expect(res.headers.get('etag')).toBe('"2"')
    const got = await route(apiRequest(`/api/drafts/${draft.id}`, { cookie: aliceCookie }))
    expect(got.headers.get('etag')).toBe('"2"')
  })

  it('a stale If-Match is 412 with the current version and writes nothing', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    await patchDraft(draft.id, { title: 'Theirs' })
    const before = await rowOf(draft.id)
    const res = await patchDraft(draft.id, { title: 'Mine' }, '"1"')
    expect(res.status).toBe(412)
    // #354: the answer also carries the current draft, so the client needs no extra read.
    expect(await res.json()).toEqual({ error: 'The draft changed since you read it', version: 2, draft: expect.objectContaining({ id: draft.id, title: 'Theirs', posts: POSTS(), version: 2 }) })
    expect(res.headers.get('etag')).toBe('"2"')
    expect(await rowOf(draft.id)).toEqual(before)
  })

  it('a replay of the same body is 200 with no write, even with a now-stale If-Match', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    const first = await patchDraft(draft.id, { title: 'T', posts: [{ text: 'x', id: 'a', images: [], embeddedTweet: null }] }, '"1"')
    expect(first.status).toBe(200)
    const after = await rowOf(draft.id)
    const second = await patchDraft(draft.id, { posts: [{ embeddedTweet: null, images: [], id: 'a', text: 'x' }], title: 'T' }, '"1"')
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual(await first.json())
    expect(await rowOf(draft.id)).toEqual(after)
    expect(after.version).toBe(2)
  })

  it('* matches any version', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    await patchDraft(draft.id, { title: 'one' })
    const res = await patchDraft(draft.id, { title: 'two' }, '*')
    expect(res.status).toBe(200)
    expect((await rowOf(draft.id)).version).toBe(3)
  })

  it('a weak tag is 412 on a write, even when the number is current', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    const before = await rowOf(draft.id)
    const res = await patchDraft(draft.id, { title: 'x' }, 'W/"1"')
    expect(res.status).toBe(412)
    expect(await rowOf(draft.id)).toEqual(before)
  })

  it('one statement writes: a PATCH with a matching tag, `*` or no tag sends exactly one query', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    const seen = []
    failOn = (text) => (seen.push(text), false)
    for (const tag of [undefined, '*', '"1"']) {
      seen.length = 0
      const res = await patchDraft(draft.id, { title: `t${tag}` }, tag)
      expect(res.status).toBe(200)
      expect(seen.filter((t) => /drafts/.test(t))).toHaveLength(1)
      await db.pg.query('update drafts set version = 1 where id = $1', [draft.id])
    }
  })

  it('a strong tag that does not match is 412 with the current version and writes nothing', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    const before = await rowOf(draft.id)
    const res = await patchDraft(draft.id, { title: 'x' }, '"7"')
    expect(res.status).toBe(412)
    expect(await res.json()).toEqual({ error: 'The draft changed since you read it', version: 1, draft: expect.objectContaining({ id: draft.id, title: 'Draft', posts: POSTS(), version: 1 }) })
    expect(res.headers.get('etag')).toBe('"1"')
    expect(await rowOf(draft.id)).toEqual(before)
  })

  it('a huge If-Match number is 412 with the current version and writes nothing', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    const before = await rowOf(draft.id)
    const res = await patchDraft(draft.id, { title: 'x' }, '"99999999999"')
    expect(res.status).toBe(412)
    expect((await res.json()).version).toBe(1)
    expect(await rowOf(draft.id)).toEqual(before)
  })

  it('a replay is 200 with a weak or a mismatching tag too, and writes nothing', async () => {
    const draft = await db.insertDraft(alice.id, { title: 'Same', posts: POSTS() })
    const before = await rowOf(draft.id)
    for (const tag of ['W/"1"', '"9"']) {
      const res = await patchDraft(draft.id, { title: 'Same' }, tag)
      expect(res.status).toBe(200)
      expect(res.headers.get('etag')).toBe('"1"')
    }
    expect(await rowOf(draft.id)).toEqual(before)
  })

  it('a non-owner with a stale tag, `*` or a replay body still gets 404 and nothing changes', async () => {
    const draft = await db.insertDraft(alice.id, { title: 'Same', posts: POSTS() })
    const before = await rowOf(draft.id)
    const bob = await db.insertUser({ github_id: 2, login: 'bob' })
    const bobCookie = await db.cookieFor(bob)
    for (const [body, tag] of [[{ title: 'Same' }, '*'], [{ title: 'Other' }, '"5"'], [{ title: 'Other' }, undefined]]) {
      const res = await route(apiRequest(`/api/drafts/${draft.id}`, { method: 'PATCH', body, cookie: bobCookie, headers: tag === undefined ? {} : { 'if-match': tag } }))
      expect(res.status).toBe(404)
    }
    expect(await rowOf(draft.id)).toEqual(before)
  })

  it('two concurrent writes with the same tag: one 200 and one 412', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    const [r1, r2] = await Promise.all([patchDraft(draft.id, { title: 'A' }, '"1"'), patchDraft(draft.id, { title: 'B' }, '"1"')])
    expect([r1.status, r2.status].sort()).toEqual([200, 412])
    const row = await rowOf(draft.id)
    expect(row.version).toBe(2)
    expect(row.title).toBe([r1, r2].findIndex((r) => r.status === 200) === 0 ? 'A' : 'B')
  })

  it.each(['1', '"abc"', '"1", "2"', 'W/1', ''])('a malformed If-Match (%j) is 400 and writes nothing', async (value) => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    const before = await rowOf(draft.id)
    expect((await patchDraft(draft.id, { title: 'x' }, value)).status).toBe(400)
    expect((await publish(draft.id, value)).status).toBe(400)
    expect((await patchPost(draft.id, 'a', { text: 'x' }, value)).status).toBe(400)
    expect(await rowOf(draft.id)).toEqual(before)
  })

  it('a failure while writing rolls back, and a retry applies once', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    const before = await rowOf(draft.id)
    failOn = (text) => text.startsWith('update drafts')
    expect((await patchDraft(draft.id, { title: 'x' })).status).toBe(500)
    failOn = null
    expect(await rowOf(draft.id)).toEqual(before)
    expect((await patchDraft(draft.id, { title: 'x' })).status).toBe(200)
    expect((await rowOf(draft.id)).version).toBe(before.version + 1)
  })

  it('another user gets 404', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    const bob = await db.insertUser({ github_id: 2, login: 'bob' })
    const res = await route(apiRequest(`/api/drafts/${draft.id}`, { method: 'PATCH', body: { title: 'x' }, cookie: await db.cookieFor(bob) }))
    expect(res.status).toBe(404)
  })
})

describe('POST /api/drafts/:id/publish', () => {
  const withImage = () => [{ id: 'a', text: 'first', images: [{ url: 'https://blob.test/a.png' }], embeddedTweet: null }]

  it('a stale If-Match is 412 with the current version, nothing written, no file deleted', async () => {
    const draft = await db.insertDraft(alice.id, { posts: withImage() })
    await patchDraft(draft.id, { title: 'moved on' })
    const before = await rowOf(draft.id)
    const res = await publish(draft.id, '"1"')
    expect(res.status).toBe(412)
    expect((await res.json()).version).toBe(2)
    expect(await rowOf(draft.id)).toEqual(before)
    expect(deleteBlobUrls).not.toHaveBeenCalled()
  })

  it('publishes once; a replay is 200 with no write', async () => {
    const draft = await db.insertDraft(alice.id, { posts: withImage() })
    const first = await publish(draft.id, '"1"')
    expect(first.status).toBe(200)
    expect(first.headers.get('etag')).toBe('"2"')
    const after = await rowOf(draft.id)
    expect(after.is_published).toBe(true)
    expect(after.posts[0].images).toEqual([])
    const deletes = deleteBlobUrls.mock.calls.length
    const second = await publish(draft.id, '"1"')
    expect(second.status).toBe(200)
    expect(await rowOf(draft.id)).toEqual(after)
    expect(deleteBlobUrls.mock.calls.length).toBe(deletes)
  })

  it('* and a weak tag follow the same rules', async () => {
    const a = await db.insertDraft(alice.id, { posts: POSTS() })
    const b = await db.insertDraft(alice.id, { posts: POSTS() })
    expect((await publish(a.id, 'W/"1"')).status).toBe(412)
    expect((await publish(b.id, '*')).status).toBe(200)
  })

  it('a failure while writing rolls back and deletes no file', async () => {
    const draft = await db.insertDraft(alice.id, { posts: withImage() })
    const before = await rowOf(draft.id)
    failOn = (text) => text.startsWith('update drafts')
    expect((await publish(draft.id)).status).toBe(500)
    failOn = null
    expect(await rowOf(draft.id)).toEqual(before)
    expect(deleteBlobUrls).not.toHaveBeenCalled()
  })
})

describe('per-post PATCH If-Match', () => {
  it('* matches; a weak tag is 412', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    expect((await patchPost(draft.id, 'a', { text: 'one' }, 'W/"1"')).status).toBe(412)
    expect((await patchPost(draft.id, 'a', { text: 'one' }, '*')).status).toBe(200)
  })
})

describe('MCP post tools', () => {
  const run = (name, args) => callTool(name, args, { caller: { uid: alice.id }, origin: 'https://app.test' })
  // Spy on the router the tools call (the real one still runs).
  let spy
  beforeEach(() => {
    spy = vi.spyOn(router, 'route')
  })
  const routeCalls = () => spy.mock.calls.map(([req]) => `${req.method} ${new URL(req.url).pathname}`).filter((call) => call.includes('/drafts/'))

  it.each([
    ['add_post', (id) => ({ id, text: 'new' }), (id) => `POST /api/drafts/${id}/posts`],
    ['remove_post', (id) => ({ id, post_id: 'a' }), (id) => `DELETE /api/drafts/${id}/posts/a`],
    ['move_post', (id) => ({ id, post_id: 'b', position: 1 }), (id) => `POST /api/drafts/${id}/posts/b/move`]
  ])('%s is one route call, with no read and PATCH of the whole draft', async (name, args, expected) => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    await patchDraft(draft.id, { title: 'bump' }) // version 2
    spy.mockClear()
    const result = await run(name, args(draft.id))
    expect(result.isError).toBe(false)
    expect(routeCalls()).toEqual([expected(draft.id)])
    expect((await rowOf(draft.id)).version).toBe(3)
  })

  it('a save that lands between the route read and its write is kept: the edit is planned again on the newer draft', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    beforePostWrite = () => db.pg.query("update drafts set title = 'theirs', version = version + 1 where id = $1", [draft.id])
    const result = await run('remove_post', { id: draft.id, post_id: 'a' })
    expect(result.isError).toBe(false)
    const row = await rowOf(draft.id)
    expect(row).toMatchObject({ title: 'theirs', version: 3 })
    expect(row.posts.map((post) => post.id)).toEqual(['b'])
  })

  it('move_post with a stale version is a 412 tool error that says to re-read, and writes nothing', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    await patchDraft(draft.id, { title: 'theirs' }) // version 2
    const result = await run('move_post', { id: draft.id, post_id: 'b', position: 1, version: 1 })
    expect(result.isError).toBe(true)
    expect(result.structuredContent.version).toBe(2)
    expect(result.content[0].text).toMatch(/get_draft/)
    expect((await rowOf(draft.id)).posts.map((post) => post.id)).toEqual(['a', 'b'])
  })

  it('add_post with a client id: replay is a no-op, other text is 409', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    const first = await run('add_post', { id: draft.id, text: 'new', post_id: 'mine' })
    expect(first.isError).toBe(false)
    const after = await rowOf(draft.id)
    expect(after.posts.map((p) => p.id)).toEqual(['a', 'b', 'mine'])

    const replay = await run('add_post', { id: draft.id, text: 'new', post_id: 'mine' })
    expect(replay.isError).toBe(false)
    expect(await rowOf(draft.id)).toEqual(after)

    const conflict = await run('add_post', { id: draft.id, text: 'different', post_id: 'mine' })
    expect(conflict.isError).toBe(true)
    expect(conflict.content[0].text).toMatch(/already exists/)
    expect(await rowOf(draft.id)).toEqual(after)
  })

  it.each(['', '.', '..', 'a/b', 'a b', 'x?y'])('add_post refuses post_id %j and writes nothing', async (postId) => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    const before = await rowOf(draft.id)
    const result = await run('add_post', { id: draft.id, text: 'new', post_id: postId })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/post_id/)
    expect(await rowOf(draft.id)).toEqual(before)
  })

  it('add_post with a valid id (and a UUID) can be edited by update_post', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    const uuid = '0b6f1c1e-3c1a-4a52-9d3e-5d1f2b9c7a10'
    expect((await run('add_post', { id: draft.id, text: 'new', post_id: 'my_post-1' })).isError).toBe(false)
    expect((await run('add_post', { id: draft.id, text: 'uuid', post_id: uuid })).isError).toBe(false)
    expect((await run('update_post', { id: draft.id, post_id: 'my_post-1', text: 'edited' })).isError).toBe(false)
    expect((await run('update_post', { id: draft.id, post_id: uuid, text: 'edited too' })).isError).toBe(false)
    expect((await rowOf(draft.id)).posts.map((p) => p.text)).toEqual(['first', 'second', 'edited', 'edited too'])
  })
})
