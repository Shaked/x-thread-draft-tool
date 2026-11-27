// @vitest-environment node
// E273 task H2 (#375): the trigger on drafts writes revisions inside the same statement. PGlite runs it as PL/pgSQL.
// One seeded beforeAll runs every scenario; the tests only read the results. All text is fake.
import { beforeAll, describe, expect, it } from 'vitest'
import { setupTestDb } from './helpers/db.js'

let db
const R = {} // scenario results, filled by beforeAll

const post = (id, text) => ({ id, text, images: [], embeddedTweet: null })
const j = (value) => JSON.stringify(value)

async function newDraft(userId, posts, title = 'T', actor = ['user', 'alice']) {
  const { rows } = await db.pg.query(
    "insert into drafts (user_id, title, posts, last_actor_kind, last_actor_name, last_label) values ($1, $2, $3::jsonb, $4, $5, null) returning *",
    [userId, title, j(posts), actor[0], actor[1]]
  )
  return rows[0]
}

/** One write: sets the new posts, title, actor and label and bumps the version, like the routes do. */
async function write(id, { posts, title, actor = ['user', 'alice'], label = null }) {
  const { rows } = await db.pg.query(
    `update drafts set posts = coalesce($2::jsonb, posts), title = coalesce($3, title), version = version + 1,
       last_actor_kind = $4, last_actor_name = $5, last_label = $6 where id = $1 returning *`,
    [id, posts ? j(posts) : null, title ?? null, actor[0], actor[1], label]
  )
  return rows[0]
}

const revisions = async (id) =>
  (await db.pg.query('select * from draft_revisions where draft_id = $1 order by seq', [id])).rows
const versions = async (id, seq) =>
  (await db.pg.query('select post_id, body from draft_post_versions where draft_id = $1 and seq = $2 order by post_id', [id, seq])).rows

/** Rebuilds the draft at revision `seq` from the tables alone: newest post_order, then the newest body per id. */
async function rebuild(id, seq) {
  const { rows: order } = await db.pg.query(
    'select post_order, title from draft_revisions where draft_id = $1 and seq <= $2 order by seq desc', [id, seq])
  const ids = order.find((row) => row.post_order)?.post_order ?? []
  const title = order.find((row) => row.title !== null)?.title
  const { rows } = await db.pg.query(
    `select distinct on (post_id) post_id, body from draft_post_versions
      where draft_id = $1 and seq <= $2 order by post_id, seq desc`, [id, seq])
  const bodies = new Map(rows.map((row) => [row.post_id, row.body]))
  return { title, posts: ids.map((postId) => bodies.get(postId)) }
}

// A small seeded generator (mulberry32), so the 50 edits are the same on every run.
function seeded(seed) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

beforeAll(async () => {
  db = await setupTestDb()
  const user = await db.insertUser()
  const base = [post('a', 'one'), post('b', 'two'), post('c', 'three')]

  // Create: revision 1 with every post, the title and the order.
  const created = await newDraft(user.id, base, 'Start')
  R.create = { revs: await revisions(created.id), vers: await versions(created.id, 1) }

  // A one-post edit by another actor: one post row. A title-only edit: no post row.
  const edit = await write(created.id, { posts: [post('a', 'one'), post('b', 'two!'), post('c', 'three')], actor: ['user', 'bob'] })
  R.edit = { revs: await revisions(created.id), vers: await versions(created.id, 2), version: edit.version }
  await write(created.id, { title: 'Renamed', actor: ['mcp', 'claude'] })
  R.title = { revs: await revisions(created.id), vers: await versions(created.id, 3) }

  // Add, remove, move: each stores post_order (and a null body for the removed post).
  await write(created.id, { posts: [post('a', 'one'), post('b', 'two!'), post('d', 'four'), post('c', 'three')], actor: ['mcp', 'x1'] })
  const added = await revisions(created.id)
  await write(created.id, { posts: [post('a', 'one'), post('d', 'four'), post('c', 'three')], actor: ['mcp', 'x2'] })
  const removed = await revisions(created.id)
  R.removedVers = await versions(created.id, removed.at(-1).seq)
  await write(created.id, { posts: [post('c', 'three'), post('a', 'one'), post('d', 'four')], actor: ['mcp', 'x3'] })
  const moved = await revisions(created.id)
  R.order = { added: added.at(-1).post_order, removed: removed.at(-1).post_order, moved: moved.at(-1).post_order }
  R.moveVers = await versions(created.id, moved.at(-1).seq)

  // A version-only write makes no revision.
  const before = (await revisions(created.id)).length
  await write(created.id, {})
  R.noop = { before, after: (await revisions(created.id)).length }

  // Merge: same actor within 2 minutes updates in place; past the window, a new row; another actor, a new row.
  const m = await newDraft(user.id, [post('p', 'v1')], 'M', ['user', 'alice'])
  await write(m.id, { posts: [post('p', 'v2')] })
  await write(m.id, { posts: [post('p', 'v3')], title: 'M2' })
  R.merged = { revs: await revisions(m.id), vers: await versions(m.id, 1) }
  await write(m.id, { posts: [post('p', 'v4')], actor: ['user', 'bob'] })
  await db.pg.query("update draft_revisions set created_at = now() - interval '3 minutes' where draft_id = $1", [m.id])
  await write(m.id, { posts: [post('p', 'v5')], actor: ['user', 'bob'] })
  R.window = await revisions(m.id)
  await write(m.id, { posts: [post('p', 'v6')], actor: ['user', 'bob'], label: 'Named' })
  await write(m.id, { posts: [post('p', 'v7')], actor: ['user', 'bob'], label: 'Named' })
  await write(m.id, { posts: [post('p', 'v8')], actor: ['restore', 'bob'] })
  await write(m.id, { posts: [post('p', 'v9')], actor: ['restore', 'bob'] })
  R.never = await revisions(m.id)

  // An old draft (written before the migration: no revision rows): revision 0 first, then the change, once.
  const old = await newDraft(user.id, [post('o1', 'old one'), post('o2', 'old two')], 'Old')
  await db.pg.query('delete from draft_revisions where draft_id = $1', [old.id])
  await write(old.id, { posts: [post('o1', 'old one'), post('o2', 'new two')], actor: ['user', 'carol'] })
  await write(old.id, { posts: [post('o1', 'old one'), post('o2', 'newer two')], actor: ['user', 'dave'] })
  R.old = { revs: await revisions(old.id), base: await versions(old.id, 0), rebuilt0: await rebuild(old.id, 0) }

  // Rewrite mode: an UPDATE makes no revision, and the next normal write still diffs against the rewritten state.
  const rw = await newDraft(user.id, [post('r', 'plain')], 'RW')
  await db.pg.query("begin")
  await db.pg.query("select set_config('app.revision_mode', 'rewrite', true)")
  await db.pg.query("update drafts set posts = $2::jsonb where id = $1", [rw.id, j([post('r', 'sealed')])])
  await db.pg.query("commit")
  R.rewrite = { revs: await revisions(rw.id) }
  await write(rw.id, { posts: [post('r', 'plain again')], actor: ['user', 'erin'] })
  R.afterRewrite = await revisions(rw.id)

  // Cascade: deleting the draft removes its revision rows.
  const gone = await newDraft(user.id, [post('g', 'gone')])
  await write(gone.id, { posts: [post('g', 'gone 2')], actor: ['user', 'z'] })
  await db.pg.query('delete from drafts where id = $1', [gone.id])
  R.cascade = (await db.pg.query('select (select count(*)::int from draft_revisions where draft_id = $1) r, (select count(*)::int from draft_post_versions where draft_id = $1) v', [gone.id])).rows[0]

  // 50 seeded edits (Hebrew and emoji), mixed actors and labels. After every write the newest revision rebuilds to the
  // written state; at the end every revision rebuilds to the last state written into it.
  const rnd = seeded(375)
  const pick = (list) => list[Math.floor(rnd() * list.length)]
  const texts = ['שלום עולם', 'hello 🌍', 'עוד פוסט 🎉', 'plain text', 'שורה אחת\nושתיים', '🙂🙃 mixed עברית']
  const actors = [['user', 'alice'], ['user', 'bob'], ['mcp', 'claude']]
  let counter = 0
  let state = { title: 'Gen', posts: [post('g0', texts[0]), post('g1', texts[1]), post('g2', texts[2])] }
  const gen = await newDraft(user.id, state.posts, state.title)
  const written = new Map([[1, structuredClone(state)]])
  let rebuildMismatch = null
  for (let i = 0; i < 50; i += 1) {
    const next = structuredClone(state)
    const op = pick(['edit', 'edit', 'add', 'remove', 'move', 'title', 'nothing'])
    if (op === 'edit') next.posts[Math.floor(rnd() * next.posts.length)].text = `${pick(texts)} ${i}`
    if (op === 'add') next.posts.splice(Math.floor(rnd() * (next.posts.length + 1)), 0, post(`g${(counter += 1) + 2}`, pick(texts)))
    if (op === 'remove' && next.posts.length > 1) next.posts.splice(Math.floor(rnd() * next.posts.length), 1)
    if (op === 'move' && next.posts.length > 1) next.posts.push(next.posts.shift())
    if (op === 'title') next.title = `${pick(texts)} ${i}`
    await write(gen.id, { posts: next.posts, title: next.title, actor: pick(actors), label: rnd() < 0.2 ? `L${i}` : null })
    state = next
    const newest = (await revisions(gen.id)).at(-1).seq
    written.set(newest, structuredClone(state))
    const rebuilt = await rebuild(gen.id, newest)
    if (JSON.stringify(rebuilt) !== JSON.stringify(state) && !rebuildMismatch) rebuildMismatch = { i, op, rebuilt, state }
  }
  const mismatches = []
  for (const [seq, expected] of written) {
    if (JSON.stringify(await rebuild(gen.id, seq)) !== JSON.stringify(expected)) mismatches.push(seq)
  }
  R.gen = { rebuildMismatch, mismatches, revisions: written.size }
}, 20000)

describe('draft revisions trigger (#375)', () => {
  it('create gives revision 1 with every post, the title and the order', () => {
    expect(R.create.revs).toHaveLength(1)
    expect(R.create.revs[0]).toMatchObject({ seq: 1, title: 'Start', post_order: ['a', 'b', 'c'], actor_kind: 'user', actor_name: 'alice' })
    expect(R.create.vers.map((row) => row.post_id)).toEqual(['a', 'b', 'c'])
  })

  it('a one-post edit stores one post row and no title or order', () => {
    expect(R.edit.revs.at(-1)).toMatchObject({ seq: 2, title: null, post_order: null, actor_name: 'bob', version: R.edit.version })
    expect(R.edit.vers).toEqual([{ post_id: 'b', body: post('b', 'two!') }])
  })

  it('a title change stores title and no post rows', () => {
    expect(R.title.revs.at(-1)).toMatchObject({ seq: 3, title: 'Renamed', post_order: null })
    expect(R.title.vers).toEqual([])
  })

  it('add, remove and move store post_order; a removed post has a null body; a move stores no bodies', () => {
    expect(R.order.added).toEqual(['a', 'b', 'd', 'c'])
    expect(R.order.removed).toEqual(['a', 'd', 'c'])
    expect(R.order.moved).toEqual(['c', 'a', 'd'])
    expect(R.removedVers).toEqual([{ post_id: 'b', body: null }])
    expect(R.moveVers).toEqual([])
  })

  it('a write that changes only the version makes no revision', () => {
    expect(R.noop.after).toBe(R.noop.before)
  })

  it('the same actor within 2 minutes merges in place: new version, new bodies, title kept', () => {
    expect(R.merged.revs).toHaveLength(1)
    expect(R.merged.revs[0]).toMatchObject({ seq: 1, title: 'M2', version: 3 })
    expect(R.merged.vers).toEqual([{ post_id: 'p', body: post('p', 'v3') }])
  })

  it('two actors never merge, and the window ends the merge', () => {
    expect(R.window.map((row) => [row.seq, row.actor_name])).toEqual([[1, 'alice'], [2, 'bob'], [3, 'bob']])
  })

  it('a label and a restore never merge', () => {
    const tail = R.never.slice(3).map((row) => [row.actor_kind, row.label])
    expect(tail).toEqual([['user', 'Named'], ['user', 'Named'], ['restore', null], ['restore', null]])
  })

  it('an old draft gets revision 0 "Before history started" once, with the old state, then the change', () => {
    expect(R.old.revs.map((row) => [row.seq, row.actor_kind, row.label, row.actor_name])).toEqual([
      [0, 'system', 'Before history started', null],
      [1, 'user', null, 'carol'],
      [2, 'user', null, 'dave']
    ])
    expect(R.old.base.map((row) => row.post_id)).toEqual(['o1', 'o2'])
    expect(R.old.rebuilt0).toEqual({ title: 'Old', posts: [post('o1', 'old one'), post('o2', 'old two')] })
  })

  it('rewrite mode makes no revision, and the next normal write still gets one', () => {
    expect(R.rewrite.revs).toHaveLength(1)
    expect(R.afterRewrite.map((row) => row.seq)).toEqual([1, 2])
  })

  it('deleting a draft removes its revision rows', () => {
    expect(R.cascade).toEqual({ r: 0, v: 0 })
  })

  it('50 seeded edits (Hebrew and emoji): every revision rebuilds to the state written into it', () => {
    expect(R.gen.revisions).toBeGreaterThan(10)
    expect(R.gen.rebuildMismatch).toBeNull()
    expect(R.gen.mismatches).toEqual([])
  })
})
