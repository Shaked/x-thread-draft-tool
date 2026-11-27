// @vitest-environment node
// E273 task H6 (#379): POST /drafts/:id/revisions/:seq/restore. All text is fake. The Blob listing is mocked: the tests
// decide which image files exist.
import { decodeJwt } from 'jose'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({
  putBlob: vi.fn(),
  deleteBlobUrls: vi.fn(async () => {}),
  listBlobPrefix: vi.fn(async () => ({ files: [], truncated: false }))
}))

import { listBlobPrefix } from '../../server/blob.js'
import { route } from '../../server/router.js'
import { sealViewAs } from '../../server/admin/view-as.js'
import { summaryLine } from '../../src/utils/revisionDiff.js'
import { apiRequest, setupTestDb } from './helpers/db.js'

let db
let alice
let bob
let aliceCookie
let bobCookie

beforeAll(async () => {
  db = await setupTestDb()
  alice = await db.insertUser({ github_id: 1, login: 'alice' })
  bob = await db.insertUser({ github_id: 2, login: 'bob' })
  aliceCookie = await db.cookieFor(alice)
  bobCookie = await db.cookieFor(bob)
})

const post = (id, text, images = []) => ({ id, text, images, embeddedTweet: null })
const blobUrl = (name) => `https://store.public.blob.vercel-storage.com/drafts/${alice.id}/d/${name}`

/** A draft of alice with its history: revision 1 (the insert), then one revision per update with a label (no merge). */
async function seedDraft(steps) {
  const [first, ...rest] = steps
  const { rows } = await db.pg.query('insert into drafts (user_id, title, posts) values ($1, $2, $3::jsonb) returning id', [
    alice.id,
    first.title,
    JSON.stringify(first.posts)
  ])
  const id = rows[0].id
  for (const step of rest) {
    await db.pg.query('update drafts set title = $2, posts = $3::jsonb, last_label = $4 where id = $1', [id, step.title, JSON.stringify(step.posts), step.label])
  }
  return id
}

const revisionsOf = async (id) =>
  (await db.pg.query('select seq, actor_kind, label from draft_revisions where draft_id = $1 order by seq', [id])).rows

const stored = async (id) => (await db.pg.query('select id, title, posts, version, is_published from drafts where id = $1', [id])).rows[0]

const tagOf = async (id) => `"${(await stored(id)).version}"`

const restoreReq = (id, seq, { cookie = aliceCookie, ifMatch } = {}) =>
  route(apiRequest(`/api/drafts/${id}/revisions/${seq}/restore`, { method: 'POST', cookie, headers: ifMatch === undefined ? {} : { 'if-match': ifMatch } }))

const patchPostReq = (id, postId, text, ifMatch) =>
  route(apiRequest(`/api/drafts/${id}/posts/${postId}`, { method: 'PATCH', body: { text }, cookie: aliceCookie, headers: ifMatch === undefined ? {} : { 'if-match': ifMatch } }))

// The history used by most tests: revision 1 = A,B; 2 = A edited; 3 = title "Second", A edited, C added; 4 = B,C (A removed).
const HISTORY = () => [
  { title: 'Start', posts: [post('a', 'one'), post('b', 'two')] },
  { title: 'Start', posts: [post('a', 'one edited'), post('b', 'two')], label: 'edit 2' },
  { title: 'Second', posts: [post('a', 'one edited'), post('b', 'two'), post('c', 'three')], label: 'edit 3' },
  { title: 'Second', posts: [post('b', 'two'), post('c', 'three')], label: 'edit 4' }
]

describe('restore a revision (#379)', () => {
  it('the restored state is the current state, a new revision says so, and the diff from the restored one is empty', async () => {
    const id = await seedDraft(HISTORY())
    const res = await restoreReq(id, 1, { ifMatch: await tagOf(id) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.restored_from).toBe(1)
    expect(body.images_not_restored).toBe(0)
    expect(body.draft.title).toBe('Start')
    expect(body.draft.posts).toEqual([post('a', 'one'), post('b', 'two')])
    expect(res.headers.get('etag')).toBe(`"${body.draft.version}"`)

    const revisions = await revisionsOf(id)
    expect(revisions.at(-1)).toEqual({ seq: 5, actor_kind: 'restore', label: 'Restored revision 1' })
    expect(revisions.slice(0, 4).map((r) => r.seq)).toEqual([1, 2, 3, 4])

    const diff = await route(apiRequest(`/api/drafts/${id}/revisions/5?against=1`, { cookie: aliceCookie })).then((r) => r.json())
    expect(summaryLine(diff.diff)).toBe('no changes')
  })

  it('later revisions stay: the history grows and no row is removed', async () => {
    const id = await seedDraft(HISTORY())
    const before = await revisionsOf(id)
    await restoreReq(id, 2, { ifMatch: await tagOf(id) })
    const after = await revisionsOf(id)
    expect(after.slice(0, before.length)).toEqual(before)
    expect(after).toHaveLength(before.length + 1)
  })

  it('a stale If-Match is 412 with the current draft, and nothing is written', async () => {
    const id = await seedDraft(HISTORY())
    const before = await stored(id)
    const revisionsBefore = await revisionsOf(id)
    const res = await restoreReq(id, 1, { ifMatch: '"999"' })
    expect(res.status).toBe(412)
    const body = await res.json()
    expect(body.version).toBe(before.version)
    expect(body.draft.id).toBe(id)
    expect(body.draft.posts).toEqual(before.posts)
    expect(res.headers.get('etag')).toBe(`"${before.version}"`)
    expect(await stored(id)).toEqual(before)
    expect(await revisionsOf(id)).toEqual(revisionsBefore)
  })

  it('a weak or malformed If-Match is 400 (the same parser as PATCH), and nothing is written', async () => {
    const id = await seedDraft(HISTORY())
    const before = await stored(id)
    expect((await restoreReq(id, 1, { ifMatch: 'W/"1"' })).status).toBe(412)
    expect((await restoreReq(id, 1, { ifMatch: 'nope' })).status).toBe(400)
    expect(await stored(id)).toEqual(before)
  })

  it('without If-Match the restore still works', async () => {
    const id = await seedDraft(HISTORY())
    const res = await restoreReq(id, 3)
    expect(res.status).toBe(200)
    expect((await res.json()).draft.title).toBe('Second')
  })

  it('a published draft is 409 with the exact message, and nothing is written', async () => {
    const id = await seedDraft(HISTORY())
    await db.pg.query('update drafts set is_published = true where id = $1', [id])
    const before = await stored(id)
    const revisionsBefore = await revisionsOf(id)
    const res = await restoreReq(id, 1, { ifMatch: `"${before.version}"` })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('This draft is published. Duplicate it to edit.')
    expect(await stored(id)).toEqual(before)
    expect(await revisionsOf(id)).toEqual(revisionsBefore)
  })

  it('another user gets 404 and the draft is untouched', async () => {
    const id = await seedDraft(HISTORY())
    const before = await stored(id)
    const res = await restoreReq(id, 1, { cookie: bobCookie, ifMatch: await tagOf(id) })
    expect(res.status).toBe(404)
    expect(await stored(id)).toEqual(before)
  })

  it('a view-as caller is refused (403) and nothing is written', async () => {
    const id = await seedDraft(HISTORY())
    const before = await stored(id)
    const admin = await db.insertUser({ github_id: 960015, login: 'shaked' })
    const adminCookie = await db.cookieFor(admin)
    const claim = await sealViewAs({
      adminUid: admin.id,
      adminJti: decodeJwt(adminCookie.split('=')[1]).jti,
      targetUid: alice.id,
      targetGh: '1',
      targetLogin: 'alice',
      reason: 't',
      vid: 'v-restore'
    })
    const res = await restoreReq(id, 1, { cookie: `${adminCookie}; xt_view_as=${claim}` })
    expect(res.status).toBe(403)
    expect(await stored(id)).toEqual(before)
  })

  it('an unknown revision or a bad seq is 404, and nothing is written', async () => {
    const id = await seedDraft(HISTORY())
    const before = await stored(id)
    expect((await restoreReq(id, 99)).status).toBe(404)
    expect((await restoreReq(id, 'x')).status).toBe(404)
    expect(await stored(id)).toEqual(before)
  })

  it('restoring the current state is a 200 replay with no write', async () => {
    const id = await seedDraft(HISTORY())
    const before = await stored(id)
    const revisionsBefore = await revisionsOf(id)
    const res = await restoreReq(id, 4, { ifMatch: `"${before.version}"` })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.draft.version).toBe(before.version)
    expect(body.restored_from).toBe(4)
    expect(await stored(id)).toEqual(before)
    expect(await revisionsOf(id)).toEqual(revisionsBefore)
  })

  it('a restore of a restore works: the state follows the chosen revision each time', async () => {
    const id = await seedDraft(HISTORY())
    expect((await restoreReq(id, 1)).status).toBe(200) // seq 5 = state 1
    expect((await restoreReq(id, 2)).status).toBe(200) // seq 6 = state 2
    const res = await restoreReq(id, 5) // seq 7 = state 1 again
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.draft.posts).toEqual([post('a', 'one'), post('b', 'two')])
    expect(await revisionsOf(id)).toEqual(
      expect.arrayContaining([
        { seq: 5, actor_kind: 'restore', label: 'Restored revision 1' },
        { seq: 6, actor_kind: 'restore', label: 'Restored revision 2' },
        { seq: 7, actor_kind: 'restore', label: 'Restored revision 5' }
      ])
    )
  })

  it('a restore is never merged into the revision before it, even within 2 minutes', async () => {
    const id = await seedDraft(HISTORY())
    // Two plain writes (no actor, no label): the second merges into the first, so the first is a plain revision.
    expect((await patchPostReq(id, 'c', 'three edited', await tagOf(id))).status).toBe(200)
    const plain = (await revisionsOf(id)).length
    expect((await patchPostReq(id, 'c', 'three edited again', await tagOf(id))).status).toBe(200)
    expect((await revisionsOf(id)).length).toBe(plain)
    expect((await restoreReq(id, 1)).status).toBe(200)
    expect((await revisionsOf(id)).length).toBe(plain + 1)
  })

  it('a missing image file is dropped from its post and counted; a file that is there stays', async () => {
    const here = blobUrl('here.png')
    const gone = blobUrl('gone.png')
    const external = 'https://example.com/photo.png'
    const id = await seedDraft([
      { title: 'Pics', posts: [post('a', 'one', [here, gone, external])] },
      { title: 'Pics', posts: [post('a', 'one edited', [])], label: 'edit' }
    ])
    listBlobPrefix.mockClear()
    listBlobPrefix.mockResolvedValueOnce({ files: [{ url: here, size: 10 }], truncated: false })
    const res = await restoreReq(id, 1, { ifMatch: await tagOf(id) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.images_not_restored).toBe(1)
    expect(body.draft.posts[0].images).toEqual([here, external])
    expect(listBlobPrefix).toHaveBeenCalledTimes(1)
    expect(listBlobPrefix).toHaveBeenCalledWith(`drafts/${alice.id}/`)
  })

  it('no image in the restored posts: no listing call', async () => {
    const id = await seedDraft(HISTORY())
    listBlobPrefix.mockClear()
    expect((await restoreReq(id, 1)).status).toBe(200)
    expect(listBlobPrefix).not.toHaveBeenCalled()
  })

  it('a listing that is cut off drops nothing, because an image missing from a partial listing may still exist', async () => {
    const url = blobUrl('maybe.png')
    const id = await seedDraft([
      { title: 'Pics', posts: [post('a', 'one', [url])] },
      { title: 'Pics', posts: [post('a', 'one edited', [])], label: 'edit' }
    ])
    listBlobPrefix.mockResolvedValueOnce({ files: [], truncated: true })
    const body = await (await restoreReq(id, 1, { ifMatch: await tagOf(id) })).json()
    expect(body.images_not_restored).toBe(0)
    expect(body.draft.posts[0].images).toEqual([url])
  })

  it('a listing that fails is a 503 with nothing written', async () => {
    const url = blobUrl('x.png')
    const id = await seedDraft([
      { title: 'Pics', posts: [post('a', 'one', [url])] },
      { title: 'Pics', posts: [post('a', 'one edited', [])], label: 'edit' }
    ])
    const before = await stored(id)
    listBlobPrefix.mockRejectedValueOnce(new Error('blob store down'))
    const res = await restoreReq(id, 1, { ifMatch: await tagOf(id) })
    expect(res.status).toBe(503)
    expect(await stored(id)).toEqual(before)
  })

  it('a restore with the same tag as a PATCH: exactly one wins, the other is 412', async () => {
    const id = await seedDraft(HISTORY())
    const before = await stored(id)
    const tag = `"${before.version}"`
    const [restored, patched] = await Promise.all([restoreReq(id, 1, { ifMatch: tag }), patchPostReq(id, 'b', 'two edited', tag)])
    expect([restored.status, patched.status].sort()).toEqual([200, 412])
    const winner = restored.status === 200 ? restored : patched
    expect(winner.status).toBe(200)
    // Exactly one new version and one new revision: the loser wrote nothing.
    const after = await stored(id)
    expect(after.version).toBe(before.version + 1)
    expect((await revisionsOf(id)).length).toBe(HISTORY().length + 1)
  })
})
