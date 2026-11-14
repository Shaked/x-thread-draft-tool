// @vitest-environment node
// Every route under /drafts/:id must refuse a second user (404) and a signed-out caller (401), and
// must leave the first user's draft unchanged. Each route gets a valid body and a real post id,
// because some routes check the body before they check the owner.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({ putBlob: vi.fn(), deleteBlobUrls: vi.fn(async () => {}) }))

import { ROUTES, route } from '../../server/router.js'
import { apiRequest, setupTestDb } from './helpers/db.js'

// Requests for each draft route, keyed as "METHOD /path" (as in ROUTES). A route not listed here
// fails the test below, so a new draft route cannot ship without an isolation case.
const CASES = {
  'GET /drafts/:id': {},
  'PATCH /drafts/:id': { body: { title: 'hacked' } },
  'POST /drafts/:id/publish': {},
  'POST /drafts/:id/duplicate': {},
  'GET /drafts/:id/export': { search: '?format=text' },
  'DELETE /drafts/:id': {},
  'POST /drafts/:id/share-tokens': {},
  'DELETE /drafts/:id/share-tokens': {},
  'DELETE /drafts/:id/share-tokens/:token': {},
  'PATCH /drafts/:id/posts/:postId': { body: { text: 'hacked' } }
}

const POST_ID = 'p1'
const draftRoutes = ROUTES.filter((entry) => entry.path.startsWith('/drafts/:id'))
const keyOf = (entry) => `${entry.method} ${entry.path}`

let db
let alice
let bob
let bobCookie

beforeAll(async () => {
  db = await setupTestDb()
})

beforeEach(async () => {
  await db.reset()
  alice = await db.insertUser({ github_id: 1, login: 'alice' })
  bob = await db.insertUser({ github_id: 2, login: 'bob' })
  bobCookie = await db.cookieFor(bob)
})

describe('draft routes know their isolation case', () => {
  it('has a case for every /drafts/:id route, and no case for a route that does not exist', () => {
    const known = new Set(draftRoutes.map(keyOf))
    expect(draftRoutes.map(keyOf).filter((key) => !CASES[key])).toEqual([])
    expect(Object.keys(CASES).filter((key) => !known.has(key))).toEqual([])
  })
})

describe('tenant isolation on /drafts/:id routes', () => {
  it.each(draftRoutes.map((entry) => [keyOf(entry), entry]))('%s', async (key, entry) => {
    const spec = CASES[key]
    if (!spec) throw new Error(`no isolation case for ${key}`)
    const draft = await db.insertDraft(alice.id, {
      title: 'alice draft',
      posts: [{ id: POST_ID, text: 'hello', images: [], embeddedTweet: null }]
    })
    // A real share link of alice's, so a revoke by bob has a row to (wrongly) delete.
    const { rows: link } = await db.pg.query(
      'insert into share_tokens (draft_id, created_by) values ($1, $2) returning token',
      [draft.id, alice.id]
    )
    const path =
      entry.path
        .replace('/:postId', `/${POST_ID}`)
        .replace('/:token', `/${link[0].token}`)
        .replace('/:id', `/${draft.id}`) + (spec.search ?? '')
    const send = (cookie) => route(apiRequest(`/api${path}`, { method: entry.method, body: spec.body, cookie }))

    const before = await db.pg.query('select * from drafts where id = $1', [draft.id])
    const shares = await db.pg.query('select count(*)::int as n from share_tokens where draft_id = $1', [draft.id])

    expect((await send(bobCookie)).status).toBe(404)
    expect((await send(undefined)).status).toBe(401)

    const after = await db.pg.query('select * from drafts where id = $1', [draft.id])
    expect(after.rows).toEqual(before.rows)
    const sharesAfter = await db.pg.query('select count(*)::int as n from share_tokens where draft_id = $1', [draft.id])
    expect(sharesAfter.rows[0].n).toBe(shares.rows[0].n)
  })
})
