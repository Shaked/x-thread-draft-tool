// @vitest-environment node
// Plan O1: changing one post's text is one transaction on a locked draft row. A replay of the same
// text writes nothing, a stale If-Match is refused, a failure rolls the whole write back, and two
// edits at the same time are both kept. Real route(), real SQL (PGlite); only the failures are injected.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({ putBlob: vi.fn(), deleteBlobUrls: vi.fn(async () => {}) }))

import { route } from '../../server/router.js'
import { setQueryImpl } from '../../server/db.js'
import { apiRequest, setupTestDb } from './helpers/db.js'

const POSTS = () => [
  { id: 'a', text: 'first', images: [{ url: 'https://blob.test/a.png' }], embeddedTweet: { id: 't1' } },
  { id: 'b', text: 'second', images: [], embeddedTweet: null },
  { id: 'c', text: 'third', images: [], embeddedTweet: null }
]

let db
let alice
let bob
let aliceCookie
let bobCookie
/** Set by a test to make the next matching SQL statement fail (injected failure). */
let failOn = null

beforeAll(async () => {
  db = await setupTestDb()
  setQueryImpl(async (text, params = []) => {
    if (failOn?.(text)) throw new Error('injected failure')
    const result = await db.pg.query(text, params)
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length }
  })
})

beforeEach(async () => {
  failOn = null
  await db.reset()
  alice = await db.insertUser({ github_id: 1, login: 'alice' })
  bob = await db.insertUser({ github_id: 2, login: 'bob' })
  aliceCookie = await db.cookieFor(alice)
  bobCookie = await db.cookieFor(bob)
})

const patchPost = (draftId, postId, body, { cookie = aliceCookie, ifMatch } = {}) =>
  route(
    apiRequest(`/api/drafts/${draftId}/posts/${postId}`, {
      method: 'PATCH',
      body,
      cookie,
      headers: ifMatch === undefined ? {} : { 'if-match': ifMatch }
    })
  )

const rowOf = async (id) =>
  (await db.pg.query('select posts, version, updated_at, is_published from drafts where id = $1', [id])).rows[0]

describe('PATCH /api/drafts/:id/posts/:postId', () => {
  it('changes only the text of the named post; the other posts, images and embedded tweet stay the same', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    const res = await patchPost(draft.id, 'b', { text: 'edited' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.draft.posts[0]).toEqual(POSTS()[0])
    expect(body.draft.posts[2]).toEqual(POSTS()[2])
    expect(body.draft.posts[1]).toEqual({ ...POSTS()[1], text: 'edited' })
    expect(body.draft.version).toBe(2)
    expect(res.headers.get('etag')).toBe('"2"')
  })

  it('a replay of the same text is a 200 with no write, also when If-Match is the version from before the first write', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    const first = await patchPost(draft.id, 'b', { text: 'edited' }, { ifMatch: '"1"' })
    expect(first.status).toBe(200)
    const afterFirst = await rowOf(draft.id)

    const second = await patchPost(draft.id, 'b', { text: 'edited' }, { ifMatch: '"1"' })
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual(await first.json())
    expect(await rowOf(draft.id)).toEqual(afterFirst)
    expect(afterFirst.version).toBe(2)
  })

  it('a stale If-Match with different text is refused with 412 and leaves the row unchanged', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    await patchPost(draft.id, 'b', { text: 'someone else' })
    const before = await rowOf(draft.id)

    const res = await patchPost(draft.id, 'b', { text: 'mine' }, { ifMatch: '"1"' })
    expect(res.status).toBe(412)
    // #354: the answer also carries the current draft, so the client needs no extra read.
    const posts = POSTS().map((post) => (post.id === 'b' ? { ...post, text: 'someone else' } : post))
    expect(await res.json()).toEqual({ error: 'The draft changed since you read it', version: 2, draft: expect.objectContaining({ id: draft.id, posts, version: 2 }) })
    expect(res.headers.get('etag')).toBe('"2"')
    expect(await rowOf(draft.id)).toEqual(before)
  })

  it('a failure while writing rolls the whole change back, and a retry applies it once', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    const before = await rowOf(draft.id)

    failOn = (text) => text.startsWith('update drafts')
    const failed = await patchPost(draft.id, 'b', { text: 'edited' })
    failOn = null
    expect(failed.status).toBe(500)
    expect(await rowOf(draft.id)).toEqual(before)

    const retry = await patchPost(draft.id, 'b', { text: 'edited' })
    expect(retry.status).toBe(200)
    expect((await rowOf(draft.id)).version).toBe(before.version + 1)
  })

  it('a failed write has no fallback and leaves no partial change (there is no COMMIT any more, plan P7)', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    const before = await rowOf(draft.id)

    failOn = (text) => text.startsWith('update drafts')
    const failed = await patchPost(draft.id, 'b', { text: 'edited' })
    failOn = null
    expect(failed.status).toBe(500)
    expect(await rowOf(draft.id)).toEqual(before)
  })

  it('two edits of different posts at the same time are both kept', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    const [x, y] = await Promise.all([patchPost(draft.id, 'a', { text: 'A!' }), patchPost(draft.id, 'c', { text: 'C!' })])
    expect([x.status, y.status]).toEqual([200, 200])
    const row = await rowOf(draft.id)
    expect(row.posts.map((post) => post.text)).toEqual(['A!', 'second', 'C!'])
    expect(row.version).toBe(3)
  })

  it('refuses another user with 404 and no write', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    const before = await rowOf(draft.id)
    const res = await patchPost(draft.id, 'b', { text: 'x' }, { cookie: bobCookie })
    expect(res.status).toBe(404)
    expect(await rowOf(draft.id)).toEqual(before)
  })

  it('refuses a published draft with 409', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS(), is_published: true, published_at: new Date().toISOString() })
    const res = await patchPost(draft.id, 'b', { text: 'x' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/published/)
  })

  it('an unknown post is 404', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    const res = await patchPost(draft.id, 'nope', { text: 'x' })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Post not found in this draft')
  })

  it('the first of two posts with the same id is the one changed, as findIndex did', async () => {
    const draft = await db.insertDraft(alice.id, {
      posts: [
        { id: 'dup', text: 'one', images: [], embeddedTweet: null },
        { id: 'dup', text: 'two', images: [], embeddedTweet: null }
      ]
    })
    expect((await patchPost(draft.id, 'dup', { text: 'X' })).status).toBe(200)
    expect((await rowOf(draft.id)).posts.map((post) => post.text)).toEqual(['X', 'two'])
  })

  it('a post whose text is missing gets the text', async () => {
    const draft = await db.insertDraft(alice.id, { posts: [{ id: 'm', images: [], embeddedTweet: null }] })
    const res = await patchPost(draft.id, 'm', { text: 'filled' })
    expect(res.status).toBe(200)
    expect((await rowOf(draft.id)).posts[0].text).toBe('filled')
  })

  it('a huge or weak If-Match is 412 with the current version and writes nothing', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    const before = await rowOf(draft.id)
    for (const tag of ['"99999999999"', '"2147483648"', 'W/"1"']) {
      const res = await patchPost(draft.id, 'b', { text: 'mine' }, { ifMatch: tag })
      expect(res.status).toBe(412)
      expect((await res.json()).version).toBe(1)
      expect(await rowOf(draft.id)).toEqual(before)
    }
  })

  it('one statement writes: a PATCH of one post sends exactly one draft query', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    const seen = []
    failOn = (text) => (seen.push(text), false)
    const res = await patchPost(draft.id, 'b', { text: 'once' })
    failOn = null
    expect(res.status).toBe(200)
    expect(seen.filter((text) => /drafts/.test(text))).toHaveLength(1)
  })

  it('two edits of the same post with the same If-Match at the same time: one 200 and one 412', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    const [r1, r2] = await Promise.all([patchPost(draft.id, 'b', { text: 'A' }, { ifMatch: '"1"' }), patchPost(draft.id, 'b', { text: 'B' }, { ifMatch: '"1"' })])
    expect([r1.status, r2.status].sort()).toEqual([200, 412])
    const row = await rowOf(draft.id)
    expect(row.version).toBe(2)
    expect(row.posts[1].text).toBe(r1.status === 200 ? 'A' : 'B')
  })

  it('a write that lands between the UPDATE and its read is retried, not a 412, when no tag was sent', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    // The UPDATE skips the row: post b already says "mine". Then another write changes it before the read.
    await db.pg.query(`update drafts set posts = jsonb_set(posts, '{1,text}', '"mine"') where id = $1`, [draft.id])
    let sawUpdate = false
    let raced = false
    failOn = (text) => {
      if (text.startsWith('update drafts')) sawUpdate = true
      if (sawUpdate && !raced && text.startsWith('select') && text.includes('from drafts where id')) {
        raced = true
        db.pg.query(`update drafts set posts = jsonb_set(posts, '{1,text}', '"other"') where id = $1`, [draft.id])
      }
      return false
    }
    const res = await patchPost(draft.id, 'b', { text: 'mine' })
    failOn = null
    expect(raced).toBe(true)
    expect(res.status).toBe(200)
    expect((await res.json()).draft.posts[1].text).toBe('mine')
    expect((await rowOf(draft.id)).posts[1].text).toBe('mine')
  })

  it('text over 280 characters is 400', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    const res = await patchPost(draft.id, 'b', { text: 'x'.repeat(281) })
    expect(res.status).toBe(400)
  })

  it('a 300-character URL is accepted (X counts it 23)', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    const res = await patchPost(draft.id, 'b', { text: `https://example.com/${'a'.repeat(280)}` })
    expect(res.status).toBe(200)
  })

  it('141 CJK characters (X weight 282) are 400', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    const res = await patchPost(draft.id, 'b', { text: '字'.repeat(141) })
    expect(res.status).toBe(400)
  })

  it('any field other than text is 400 and changes nothing', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    const before = await rowOf(draft.id)
    const res = await patchPost(draft.id, 'a', { text: 'x', images: [] })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Only text can be changed here')
    expect(await rowOf(draft.id)).toEqual(before)
  })
})

describe('the whole-draft PATCH also counts as a write', () => {
  it('bumps version, so a per-post If-Match taken before it is refused', async () => {
    const draft = await db.insertDraft(alice.id, { posts: POSTS() })
    const whole = await route(
      apiRequest(`/api/drafts/${draft.id}`, { method: 'PATCH', body: { title: 'Renamed' }, cookie: aliceCookie })
    )
    expect(whole.status).toBe(200)
    expect((await whole.json()).draft.version).toBe(2)
    const stale = await patchPost(draft.id, 'b', { text: 'x' }, { ifMatch: '"1"' })
    expect(stale.status).toBe(412)
  })
})
