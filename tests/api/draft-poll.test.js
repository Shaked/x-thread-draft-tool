// @vitest-environment node
// #360 (epic #273, L1 b): GET /api/drafts/:id answers 304 to If-None-Match of the current version, so an
// open editor can ask "did it change?" without the posts coming back. Real route(), real SQL (PGlite).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({ putBlob: vi.fn(), deleteBlobUrls: vi.fn(async () => {}) }))
import * as router from '../../server/router.js'
import { callTool } from '../../server/mcp/tools.js'
import { setQueryImpl } from '../../server/db.js'
import { apiRequest, setupTestDb } from './helpers/db.js'

const POSTS = () => [
  { id: 'a', text: 'post A', images: [], embeddedTweet: null },
  { id: 'b', text: 'post B', images: [], embeddedTweet: null }
]

let db
let alice
let bob
let cookie
let bobCookie
let draft

beforeAll(async () => {
  db = await setupTestDb()
})

beforeEach(async () => {
  vi.restoreAllMocks()
  await db.reset()
  alice = await db.insertUser({ github_id: 1, login: 'alice' })
  bob = await db.insertUser({ github_id: 2, login: 'bob' })
  cookie = await db.cookieFor(alice)
  bobCookie = await db.cookieFor(bob)
  draft = await db.insertDraft(alice.id, { title: 'Poll', posts: POSTS() }) // version 1
})

afterEach(() => {
  setQueryImpl(async (text, params = []) => {
    const result = await db.pg.query(text, params)
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length }
  })
  vi.restoreAllMocks()
})

/** Sends every statement to PGlite and keeps its text and rows, so a test can count them and read what came back. */
function recordStatements() {
  const seen = []
  setQueryImpl(async (text, params = []) => {
    const result = await db.pg.query(text, params)
    seen.push({ text, rows: result.rows })
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length }
  })
  return seen
}

const get = (id, { as = cookie, ifNoneMatch } = {}) =>
  router.route(apiRequest(`/api/drafts/${id}`, { cookie: as, headers: ifNoneMatch === undefined ? {} : { 'if-none-match': ifNoneMatch } }))

const ai = (name, args) => callTool(name, args, { caller: { uid: alice.id, via: 'oauth', clientName: 'Test client' }, origin: 'https://app.test' })

describe('GET /api/drafts/:id with If-None-Match (#360)', () => {
  it('answers 304 with no body and the ETag when the version is unchanged', async () => {
    const first = await get(draft.id)
    expect(first.status).toBe(200)
    expect(first.headers.get('etag')).toBe('"1"')

    const res = await get(draft.id, { ifNoneMatch: '"1"' })
    expect(res.status).toBe(304)
    expect(res.headers.get('etag')).toBe('"1"')
    expect(await res.text()).toBe('')
  })

  it('answers 200 with the full draft after an MCP update_post, then 304 for the new version', async () => {
    expect((await ai('update_post', { id: draft.id, post_id: 'b', text: 'post B by AI' })).isError).toBe(false)

    const res = await get(draft.id, { ifNoneMatch: '"1"' })
    expect(res.status).toBe(200)
    expect(res.headers.get('etag')).toBe('"2"')
    const body = await res.json()
    expect(body.draft).toMatchObject({ id: draft.id, version: 2, posts: [{ text: 'post A' }, { text: 'post B by AI' }] })

    expect((await get(draft.id, { ifNoneMatch: '"2"' })).status).toBe(304)
  })

  it('answers 404 for another user, even with the matching version, and never 304', async () => {
    const res = await get(draft.id, { as: bobCookie, ifNoneMatch: '"1"' })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Draft not found' })
  })

  it('sends the draft (200) for *, a weak tag, a list, a malformed value and a tag beyond int range', async () => {
    for (const ifNoneMatch of ['*', 'W/"1"', '"1", "2"', '1', 'garbage', '"abc"', '"99999999999"', '"0"', '"01"', '"+1"']) {
      const res = await get(draft.id, { ifNoneMatch })
      expect(res.status, ifNoneMatch).toBe(200)
      expect((await res.json()).draft.version).toBe(1)
    }
  })

  it('sends the draft (200) when there is no If-None-Match', async () => {
    expect((await get(draft.id)).status).toBe(200)
  })

  it('uses one draft statement per check: the session check and the draft check, and no posts come back when unchanged', async () => {
    const seen = recordStatements()
    const res = await get(draft.id, { ifNoneMatch: '"1"' })
    expect(res.status).toBe(304)

    // The session check (1) and the draft check (1). The draft check is the only statement that reads drafts.
    expect(seen).toHaveLength(2)
    const check = seen.filter(({ text }) => /from drafts/.test(text))
    expect(check).toHaveLength(1)
    expect(check[0].rows).toEqual([
      expect.objectContaining({ version: 1, unchanged: true, title: null, posts: null, id: null })
    ])
  })

  it('a changed draft is still one draft statement, and that statement returns the full row', async () => {
    await db.pg.query("update drafts set version = 2, posts = jsonb_set(posts, '{1,text}', '\"post B by AI\"') where id = $1", [draft.id])

    const seen = recordStatements()
    const res = await get(draft.id, { ifNoneMatch: '"1"' })
    expect(res.status).toBe(200)
    expect(seen).toHaveLength(2)
    const check = seen.filter(({ text }) => /from drafts/.test(text))
    expect(check).toHaveLength(1)
    expect(check[0].rows[0]).toMatchObject({ unchanged: false, version: 2, title: 'Poll', posts: expect.any(Array) })
  })
})
