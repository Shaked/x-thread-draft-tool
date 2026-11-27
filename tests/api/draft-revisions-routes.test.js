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

  it('the list of many revisions that each rewrite a long post stays fast and light (no body leaves the database)', async () => {
    // 60 revisions of one post of about 600 KB; each rewrites it (a new text that shares most words with the one before).
    // Built in SQL, so the test sends no big value. Without the md5 stand-ins every body reaches Node and is word-diffed.
    const { rows } = await db.pg.query(
      `insert into drafts (user_id, title, posts, last_actor_kind, last_actor_name, last_label)
       values ($1, 'Many', jsonb_build_array(jsonb_build_object('id', 'p', 'text', repeat('lorem ipsum dolor sit amet ', 22000), 'images', '[]'::jsonb, 'embeddedTweet', null)), 'user', 'alice', 'a')
       returning id`,
      [alice.id]
    )
    for (let i = 1; i <= 60; i++) {
      await db.pg.query(
        `update drafts set version = version + 1, last_actor_kind = 'user', last_actor_name = 'alice', last_label = $2,
                posts = jsonb_build_array(jsonb_build_object('id', 'p', 'text', repeat('lorem ipsum dolor sit amet ', 11000) || 'rewrite ' || $2 || ' ' || repeat('sit amet lorem ipsum ', 11000), 'images', '[]'::jsonb, 'embeddedTweet', null))
          where id = $1`,
        [rows[0].id, `r${i}`]
      )
    }
    const heap = process.memoryUsage().heapUsed
    const started = Date.now()
    const res = await get(`/api/drafts/${rows[0].id}/revisions?limit=100`)
    const out = await body(res)
    const took = Date.now() - started
    expect(res.status).toBe(200)
    expect(out.revisions).toHaveLength(61)
    expect(out.revisions[0].summary).toBe('changed post 1')
    expect(out.revisions.slice(0, 60).every((r) => r.summary === 'changed post 1')).toBe(true)
    // Measured: about 100 ms and +2 MB with the stand-ins; about 640 ms and +80 MB without them.
    expect(took).toBeLessThan(400)
    expect(process.memoryUsage().heapUsed - heap).toBeLessThan(40e6)
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

// A draft can hold a JSON null in posts (an old row, saved before the routes checked posts). A removed post (SQL NULL
// body) and a stored null post (jsonb null body) must not look alike, so the list and the read agree at every page size.
describe('null posts and the odd histories', () => {
  const states = new Map() // draft id -> seq -> state as written

  async function seed(posts, writes, { actor = ['user', 'alice'] } = {}) {
    const { rows } = await db.pg.query(
      "insert into drafts (user_id, title, posts, last_actor_kind, last_actor_name, last_label) values ($1, 'Odd', $2::jsonb, $3, $4, 'start') returning id",
      [alice.id, j(posts), actor[0], actor[1]]
    )
    const id = rows[0].id
    const seqs = new Map()
    states.set(id, seqs)
    const record = async () => {
      const { rows: last } = await db.pg.query('select max(seq) as seq from draft_revisions where draft_id = $1', [id])
      const { rows: now } = await db.pg.query('select title, posts from drafts where id = $1', [id])
      seqs.set(last[0].seq, now[0]) // a merged write overwrites its revision's state
    }
    await record()
    for (const [i, write] of writes.entries()) {
      await db.pg.query(
        'update drafts set title = coalesce($2, title), posts = coalesce($3::jsonb, posts), version = version + 1, last_actor_kind = $4, last_actor_name = $5, last_label = $6 where id = $1',
        [id, write.title ?? null, write.posts ? j(write.posts) : null, write.actor?.[0] ?? 'user', write.actor?.[1] ?? 'alice', write.label === undefined ? `w${i}` : write.label]
      )
      await record()
    }
    return id
  }

  const summaries = async (id, limit) => {
    const out = []
    let before = null
    do {
      const page = await body(await get(`/api/drafts/${id}/revisions?limit=${limit}${before === null ? '' : `&before=${before}`}`))
      out.push(...page.revisions.map((r) => [r.seq, r.summary]))
      before = page.next_before
    } while (before !== null)
    return out.sort((a, b) => b[0] - a[0])
  }

  it('a null post is not a removed post: the list says the same at limit 1 and at limit 30, and as the read', async () => {
    const id = await seed(
      [null, post('a', 'one')],
      [{ posts: [null, post('a', 'two')] }, { posts: [null, post('a', 'two'), post('b', 'new')] }]
    )
    const one = await summaries(id, 1)
    const thirty = await summaries(id, 30)
    expect(one).toEqual(thirty)
    expect(one).toHaveLength(3)
    for (const [seq, summary] of thirty) {
      const detail = await body(await get(`/api/drafts/${id}/revisions/${seq}`))
      expect(detail.state).toEqual(states.get(id).get(seq))
      expect(summary).toBe(summaryLine(detail.diff))
    }
  })

  it('merges, restores, a removed post, revision 0, duplicate ids and posts with no id all rebuild and summarise the same way', async () => {
    const noId = { text: 'legacy', images: [], embeddedTweet: null }
    const id = await seed(
      [post('d', 'first'), post('d', 'second'), noId],
      [
        { posts: [post('d', 'first'), post('d', 'second 2'), noId], label: null }, // merges into the first revision (same actor, no label)
        { posts: [post('d', 'first'), post('d', 'second 2'), noId, post('z', 'zed')], actor: ['mcp', 'claude'], label: null },
        { posts: [post('d', 'first'), post('z', 'zed')], actor: ['restore', 'alice'], label: 'Restored revision 1' },
        { posts: [post('z', 'zed'), post('d', 'first')], actor: ['system', null], label: 'moved' }
      ]
    )
    // An old draft: its revision rows are gone, so the first write stores revision 0.
    const { rows } = await db.pg.query("insert into drafts (user_id, title, posts) values ($1, 'Old', $2::jsonb) returning id", [alice.id, j([post('o', 'old')])])
    await db.pg.query('delete from draft_revisions where draft_id = $1', [rows[0].id])
    states.set(rows[0].id, new Map([[0, { title: 'Old', posts: [post('o', 'old')] }]]))
    await db.pg.query("update drafts set posts = $2::jsonb, version = version + 1, last_actor_kind = 'user', last_actor_name = 'alice', last_label = 'x' where id = $1", [rows[0].id, j([post('o', 'older')])])
    states.get(rows[0].id).set(1, { title: 'Old', posts: [post('o', 'older')] })

    for (const draftId of [id, rows[0].id]) {
      const seqs = [...states.get(draftId).keys()]
      const listed = await summaries(draftId, 2)
      expect(listed.map(([seq]) => seq).sort((a, b) => a - b)).toEqual(seqs.sort((a, b) => a - b))
      expect(await summaries(draftId, 30)).toEqual(listed)
      for (const [seq, summary] of listed) {
        const detail = await body(await get(`/api/drafts/${draftId}/revisions/${seq}`))
        expect(detail.state).toEqual(states.get(draftId).get(seq))
        expect(summary).toBe(summaryLine(detail.diff))
      }
    }
  })
})
