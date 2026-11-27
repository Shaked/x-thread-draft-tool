// @vitest-environment node
// E273 task H5 (#378): GET /drafts/:id/revisions and GET /drafts/:id/revisions/:seq. All text is fake.
// One seeded 100-step history; the tests read it.
import { decodeJwt } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import { route } from '../../server/router.js'
import { sealViewAs } from '../../server/admin/view-as.js'
import { applyDiff, diffDrafts, summaryLine } from '../../src/utils/revisionDiff.js'
import { apiRequest, setupTestDb } from './helpers/db.js'

const STEPS = 100
const post = (id, text) => ({ id, text, images: [], embeddedTweet: null })
const j = (value) => JSON.stringify(value)

let db
let alice
let bob
let aliceCookie
let bobCookie
let draft
const stored = new Map() // seq -> { title, posts } as written
let nowState

// A small seeded generator (mulberry32), so the history is the same on every run.
function seeded(seed) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const get = (path, cookie = aliceCookie) => route(apiRequest(path, { cookie }))
const body = async (res) => res.json()

beforeAll(async () => {
  db = await setupTestDb()
  alice = await db.insertUser({ github_id: 1, login: 'alice' })
  bob = await db.insertUser({ github_id: 2, login: 'bob' })
  aliceCookie = await db.cookieFor(alice)
  bobCookie = await db.cookieFor(bob)

  const rand = seeded(7)
  let title = 'Start'
  let posts = [post('a', 'one two three'), post('b', 'four five six'), post('c', 'seven eight nine')]
  const { rows } = await db.pg.query(
    "insert into drafts (user_id, title, posts, last_actor_kind, last_actor_name, last_label) values ($1, $2, $3::jsonb, 'user', 'alice', 'start') returning id",
    [alice.id, title, j(posts)]
  )
  draft = rows[0]
  stored.set(1, { title, posts })
  let nextId = 0
  for (let step = 0; step < STEPS - 1; step++) {
    const kind = Math.floor(rand() * 5)
    const at = Math.floor(rand() * posts.length)
    if (kind === 0) posts = posts.map((p, i) => (i === at ? { ...p, text: `${p.text} w${step}` } : p))
    else if (kind === 1) posts = [...posts.slice(0, 1), post(`n${nextId++}`, `new post ${step}`), ...posts.slice(1)]
    else if (kind === 2 && posts.length > 2) posts = posts.filter((_, i) => i !== at)
    else if (kind === 3 && posts.length > 1) posts = [...posts.slice(1), posts[0]]
    else title = `Title ${step}`
    // A label makes every write its own revision (writes with a label never merge).
    await db.pg.query(
      'update drafts set title = $2, posts = $3::jsonb, version = version + 1, last_actor_kind = $4, last_actor_name = $5, last_label = $6 where id = $1',
      [draft.id, title, j(posts), 'user', 'alice', `step ${step}`]
    )
    stored.set(step + 2, { title, posts })
  }
  nowState = { title, posts }
})

describe('GET /drafts/:id/revisions', () => {
  it('lists newest first, 30 by default, with the shape the issue names', async () => {
    const res = await get(`/api/drafts/${draft.id}/revisions`)
    expect(res.status).toBe(200)
    const out = await body(res)
    expect(out.revisions).toHaveLength(30)
    expect(out.revisions[0].seq).toBe(STEPS)
    expect(out.next_before).toBe(STEPS - 29)
    expect(Object.keys(out.revisions[0]).sort()).toEqual(['actor_kind', 'actor_name', 'created_at', 'label', 'seq', 'summary', 'version'])
    expect(out.revisions[0]).toMatchObject({ actor_kind: 'user', actor_name: 'alice', label: `step ${STEPS - 2}` })
    expect(Number.isNaN(Date.parse(out.revisions[0].created_at))).toBe(false)
  })

  it('pages with before and limit until the end, with no gap and no repeat', async () => {
    const seen = []
    let before = null
    let pages = 0
    do {
      const res = await get(`/api/drafts/${draft.id}/revisions?limit=40${before === null ? '' : `&before=${before}`}`)
      const out = await body(res)
      seen.push(...out.revisions.map((r) => r.seq))
      before = out.next_before
      pages++
    } while (before !== null)
    expect(pages).toBe(3)
    expect(seen).toEqual(Array.from({ length: STEPS }, (_, i) => STEPS - i))
  })

  it('refuses a bad limit or before with 400, never raising the limit', async () => {
    for (const q of ['limit=0', 'limit=101', 'limit=x', 'limit=1.5', 'before=-1', 'before=x']) {
      expect((await get(`/api/drafts/${draft.id}/revisions?${q}`)).status).toBe(400)
    }
    expect((await get(`/api/drafts/${draft.id}/revisions?limit=100`)).status).toBe(200)
  })

  it('summary is summaryLine of the change from the revision before, and has no post text', async () => {
    const out = await body(await get(`/api/drafts/${draft.id}/revisions?limit=100`))
    expect(out.revisions).toHaveLength(STEPS)
    for (const r of out.revisions) {
      const before = stored.get(r.seq - 1) ?? { title: '', posts: [] }
      expect(r.summary).toBe(summaryLine(diffDrafts(before, stored.get(r.seq))))
    }
    expect(JSON.stringify(out)).not.toMatch(/new post|one two/)
  })

  it('another user and an unknown or malformed draft get 404; no session gets 401', async () => {
    expect((await get(`/api/drafts/${draft.id}/revisions`, bobCookie)).status).toBe(404)
    expect((await get('/api/drafts/00000000-0000-4000-8000-000000000000/revisions')).status).toBe(404)
    expect((await get('/api/drafts/nope/revisions')).status).toBe(404)
    expect((await route(apiRequest(`/api/drafts/${draft.id}/revisions`))).status).toBe(401)
  })

  it('a draft with no revision rows lists nothing, not 404', async () => {
    const { rows } = await db.pg.query("insert into drafts (user_id, title, posts) values ($1, 'Old', '[]') returning id", [alice.id])
    await db.pg.query('delete from draft_revisions where draft_id = $1', [rows[0].id])
    const out = await body(await get(`/api/drafts/${rows[0].id}/revisions`))
    expect(out).toEqual({ revisions: [], next_before: null })
  })

  it('a view-as caller is refused, like GET /drafts/:id', async () => {
    const admin = await db.insertUser({ github_id: 960015, login: 'shaked' })
    const adminCookie = await db.cookieFor(admin)
    const claim = await sealViewAs({ adminUid: admin.id, adminJti: decodeJwt(adminCookie.split('=')[1]).jti, targetUid: alice.id, targetGh: '1', targetLogin: 'alice', reason: 't', vid: 'v' })
    const viewing = `${adminCookie}; xt_view_as=${claim}`
    const own = await get(`/api/drafts/${draft.id}`, viewing)
    expect(own.status).toBe(403)
    for (const path of [`/api/drafts/${draft.id}/revisions`, `/api/drafts/${draft.id}/revisions/1`]) {
      const res = await get(path, viewing)
      expect(res.status).toBe(403)
      expect(JSON.stringify(await body(res))).not.toMatch(/Start|one two/)
    }
  })
})

describe('GET /drafts/:id/revisions/:seq', () => {
  it('rebuilds the state at every seq of the 100-step history', async () => {
    for (let seq = 1; seq <= STEPS; seq++) {
      const res = await get(`/api/drafts/${draft.id}/revisions/${seq}`)
      expect(res.status).toBe(200)
      const out = await body(res)
      expect(out.state).toEqual(stored.get(seq))
      expect(out.revision.seq).toBe(seq)
    }
  })

  it('diff is against the revision before by default, and applyDiff rebuilds the state', async () => {
    for (const seq of [1, 2, 37, STEPS]) {
      const out = await body(await get(`/api/drafts/${draft.id}/revisions/${seq}`))
      const before = stored.get(seq - 1) ?? { title: '', posts: [] }
      expect(out.against).toBe(seq === 1 ? null : seq - 1)
      expect(out.diff).toEqual(JSON.parse(JSON.stringify(diffDrafts(before, stored.get(seq)))))
      expect(applyDiff(before, out.diff)).toEqual(stored.get(seq))
    }
  })

  it('against=<seq> compares with that revision, against=current with the draft now', async () => {
    const far = await body(await get(`/api/drafts/${draft.id}/revisions/80?against=10`))
    expect(far.against).toBe(10)
    expect(applyDiff(stored.get(10), far.diff)).toEqual(stored.get(80))
    const same = await body(await get(`/api/drafts/${draft.id}/revisions/80?against=80`))
    expect(summaryLine(same.diff)).toBe('no changes')

    const now = await body(await get(`/api/drafts/${draft.id}/revisions/5?against=current`))
    expect(now.against).toBe('current')
    expect(now.state).toEqual(stored.get(5))
    expect(applyDiff(nowState, now.diff)).toEqual(stored.get(5))
    const latest = await body(await get(`/api/drafts/${draft.id}/revisions/${STEPS}?against=current`))
    expect(summaryLine(latest.diff)).toBe('no changes')
  })

  it('404 for an unknown seq or against, another user, or a bad id; 400 for a bad against', async () => {
    for (const path of [`/revisions/${STEPS + 1}`, '/revisions/0', '/revisions/x', '/revisions/99999999999', `/revisions/5?against=${STEPS + 1}`]) {
      expect((await get(`/api/drafts/${draft.id}${path}`)).status).toBe(404)
    }
    expect((await get(`/api/drafts/${draft.id}/revisions/5?against=x`)).status).toBe(400)
    expect((await get(`/api/drafts/${draft.id}/revisions/5`, bobCookie)).status).toBe(404)
    expect((await get(`/api/drafts/${draft.id}/revisions/5?against=current`, bobCookie)).status).toBe(404)
    expect((await get('/api/drafts/nope/revisions/5')).status).toBe(404)
    expect((await route(apiRequest(`/api/drafts/${draft.id}/revisions/5`))).status).toBe(401)
  })

  it('a very long post is diffed without blocking (the bounded word diff)', async () => {
    const big = (tag) => Array.from({ length: 30000 }, (_, i) => `w${i % 97}${tag}${i}`).join(' ')
    const { rows } = await db.pg.query(
      "insert into drafts (user_id, title, posts, last_actor_kind, last_actor_name, last_label) values ($1, 'Big', $2::jsonb, 'user', 'alice', 'a') returning id",
      [alice.id, j([post('p', big('x'))])]
    )
    await db.pg.query(
      "update drafts set posts = $2::jsonb, version = version + 1, last_actor_kind = 'user', last_actor_name = 'alice', last_label = 'b' where id = $1",
      [rows[0].id, j([post('p', big('y'))])]
    )
    const started = Date.now()
    const res = await get(`/api/drafts/${rows[0].id}/revisions/2`)
    const list = await get(`/api/drafts/${rows[0].id}/revisions`)
    expect(res.status).toBe(200)
    expect(list.status).toBe(200)
    expect(Date.now() - started).toBeLessThan(2000)
  })
})
