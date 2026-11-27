// Read the history of a draft (E273 task H5, #378): list the revisions, read one with its diff.
// Owner only, like GET /drafts/:id: a non-owner, an unknown draft and an unknown revision are all 404; a view-as
// caller is refused (403). Every route is one SQL statement after the session check (query budget: 2 per call).
// Draft text is in the answer for the owner and nowhere else: this file logs nothing, and the diff comes from the
// bounded src/utils/revisionDiff.js.
import { query } from '../db.js'
import { HttpError, json } from '../http.js'
import { requireUser } from '../session.js'
import { diffDrafts, summaryLine } from '../../src/utils/revisionDiff.js'
import { isUuid, notFound, refuseWhenViewing } from './drafts.js'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100
const MAX_SEQ = 2147483647
const EMPTY = { title: '', posts: [] }

/** A whole number from a query parameter, or null when the parameter is absent. A bad value is a 400. */
function intParam(url, name, { min, max }) {
  const raw = url.searchParams.get(name)
  if (raw === null) return null
  const value = /^\d+$/.test(raw) ? Number(raw) : NaN
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new HttpError(400, `${name} must be a whole number from ${min} to ${max}`)
  return value
}

const meta = (r) => ({
  seq: r.seq,
  version: r.version,
  created_at: new Date(r.created_at).toISOString(),
  actor_kind: r.actor_kind,
  actor_name: r.actor_name,
  label: r.label
})

/** A draft state from a title, the post id order and the newest body of each post id. */
const stateOf = (title, order, bodies) => ({
  title: title ?? '',
  posts: (order ?? []).map((id) => bodies[id]).filter((post) => post !== undefined)
})

/**
 * GET /api/drafts/:id/revisions?before=<seq>&limit=1..100 (default 30): newest first. Each row has the actor, the
 * label and `summary` (summaryLine of the change from the revision before it; no post text). `next_before` is the
 * seq to pass as `before` for the next page, or null.
 * One statement reads the page, the state just before its oldest revision, and the post rows inside it; the page is
 * then replayed oldest to newest, so nothing is rebuilt per row.
 */
async function listRevisions({ request, params, url }) {
  const session = await requireUser(request)
  refuseWhenViewing(session)
  if (!isUuid(params.id)) throw notFound()
  const before = intParam(url, 'before', { min: 0, max: MAX_SEQ })
  const limit = intParam(url, 'limit', { min: 1, max: MAX_LIMIT }) ?? DEFAULT_LIMIT

  const { rows } = await query(
    `with d as (select id from drafts where id = $1 and user_id = $2),
          page as (select seq, version, created_at, actor_kind, actor_name, label, title, post_order
                     from draft_revisions
                    where draft_id = $1 and exists (select 1 from d) and ($3::int is null or seq < $3)
                    order by seq desc limit $4::int + 1),
          shown as (select * from page order by seq desc limit $4::int),
          low as (select min(seq) as seq from shown),
          high as (select max(seq) as seq from shown)
     select exists (select 1 from d) as owned,
            (select count(*) from page)::int as found,
            (select coalesce(jsonb_agg(to_jsonb(s) order by s.seq), '[]'::jsonb) from shown s) as revisions,
            (select title from draft_revisions where draft_id = $1 and seq < (select seq from low) and title is not null
              order by seq desc limit 1) as base_title,
            (select post_order from draft_revisions where draft_id = $1 and seq < (select seq from low) and post_order is not null
              order by seq desc limit 1) as base_order,
            (select coalesce(jsonb_object_agg(x.post_id, x.body), '{}'::jsonb)
               from (select distinct on (post_id) post_id, body from draft_post_versions
                      where draft_id = $1 and seq < (select seq from low) order by post_id, seq desc) x
              where x.body is not null) as base_bodies,
            (select coalesce(jsonb_agg(jsonb_build_array(v.seq, v.post_id, v.body, v.body is null)), '[]'::jsonb)
               from draft_post_versions v
              where v.draft_id = $1 and v.seq >= (select seq from low) and v.seq <= (select seq from high)) as changes`,
    [params.id, session.uid, before, limit]
  )
  const row = rows[0]
  if (!row?.owned) throw notFound()

  // Replay from the oldest shown revision up: apply its post rows, its title and its order, then diff with the state before.
  const revisions = row.revisions // oldest first
  const changesBySeq = new Map()
  // A post of a draft can be a JSON null (an old row): only the flag says "removed", never the body.
  for (const [seq, postId, body, removed] of row.changes) {
    if (!changesBySeq.has(seq)) changesBySeq.set(seq, [])
    changesBySeq.get(seq).push([postId, body, removed])
  }
  // The summary reads only the structure of the diff (which posts changed, were added, removed or moved), never the
  // words. So each text is swapped for a short stand-in, one per distinct text: equal texts stay equal and different
  // ones stay different, and the word diff runs on a few characters, not on a long post.
  const standIns = new Map()
  const light = (post) => {
    if (post === null || typeof post !== 'object' || typeof post.text !== 'string') return post
    if (!standIns.has(post.text)) standIns.set(post.text, `#${standIns.size}`)
    return { ...post, text: standIns.get(post.text) }
  }
  let title = row.base_title
  let order = row.base_order
  const bodies = Object.fromEntries(Object.entries(row.base_bodies ?? {}).map(([id, post]) => [id, light(post)]))
  let previous = row.base_order === null && row.base_title === null ? EMPTY : stateOf(title, order, bodies)
  const items = []
  for (const rev of revisions) {
    for (const [postId, body, removed] of changesBySeq.get(rev.seq) ?? []) {
      if (removed) delete bodies[postId]
      else bodies[postId] = light(body)
    }
    if (rev.title !== null) title = rev.title
    if (rev.post_order !== null) order = rev.post_order
    const current = stateOf(title, order, bodies)
    items.push({ ...meta(rev), summary: summaryLine(diffDrafts(previous, current)) })
    previous = current
  }
  items.reverse()
  const more = row.found > limit
  return json({ revisions: items, next_before: more ? items.at(-1).seq : null })
}

/**
 * GET /api/drafts/:id/revisions/:seq?against=<seq>|current: the draft as it was at `seq` ({ title, posts }) and `diff`
 * = diffDrafts(state at against, state at seq). `against` defaults to the revision before (the first revision is
 * compared with an empty draft); `current` compares with the draft now. Unknown draft or seq (or against) is 404.
 * The state is rebuilt in one statement: the newest title and post order at or before the seq, then the newest body
 * of each post id at or before it.
 */
async function getRevision({ request, params, url }) {
  const session = await requireUser(request)
  refuseWhenViewing(session)
  if (!isUuid(params.id)) throw notFound()
  if (!/^\d+$/.test(params.seq) || Number(params.seq) > MAX_SEQ) throw notFound()
  const seq = Number(params.seq)
  const rawAgainst = url.searchParams.get('against')
  const current = rawAgainst === 'current'
  let against = null
  if (rawAgainst !== null && !current) {
    if (!/^\d+$/.test(rawAgainst) || Number(rawAgainst) > MAX_SEQ) throw new HttpError(400, 'against must be a revision seq or current')
    against = Number(rawAgainst)
  }

  const { rows } = await query(
    `with d as (select title, posts from drafts where id = $1 and user_id = $2),
          r as (select seq, version, created_at, actor_kind, actor_name, label
                  from draft_revisions where draft_id = $1 and seq = $3 and exists (select 1 from d)),
          want as (select case when $5::boolean then null
                               when $4::int is not null then $4::int
                               else (select max(seq) from draft_revisions where draft_id = $1 and seq < $3) end as seq),
          a as (select seq from draft_revisions where draft_id = $1 and exists (select 1 from d) and seq = (select seq from want)),
          picked as (select seq from r union select seq from a),
          states as (select p.seq,
                            (select title from draft_revisions where draft_id = $1 and seq <= p.seq and title is not null
                              order by seq desc limit 1) as title,
                            (select post_order from draft_revisions where draft_id = $1 and seq <= p.seq and post_order is not null
                              order by seq desc limit 1) as post_order,
                            (select coalesce(jsonb_object_agg(x.post_id, x.body), '{}'::jsonb)
                               from (select distinct on (post_id) post_id, body from draft_post_versions
                                      where draft_id = $1 and seq <= p.seq order by post_id, seq desc) x
                              where x.body is not null) as bodies
                       from picked p)
     select exists (select 1 from d) as owned,
            (select to_jsonb(r) from r) as rev,
            (select seq from a) as against_seq,
            (select seq from want) as want_seq,
            (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from states s) as states,
            case when $5::boolean then (select to_jsonb(d) from d) end as now`,
    [params.id, session.uid, seq, against, current]
  )
  const row = rows[0]
  if (!row?.owned || !row.rev) throw notFound()
  if (row.want_seq !== null && row.against_seq === null) throw notFound()

  const rebuilt = (s) => {
    const found = row.states.find((state) => state.seq === s)
    return stateOf(found.title, found.post_order, found.bodies)
  }
  const state = rebuilt(seq)
  let from = EMPTY
  let label = null
  if (current) {
    from = { title: row.now?.title ?? '', posts: Array.isArray(row.now?.posts) ? row.now.posts : [] }
    label = 'current'
  } else if (row.against_seq !== null) {
    from = rebuilt(row.against_seq)
    label = row.against_seq
  }
  return json({ revision: meta(row.rev), state, against: label, diff: diffDrafts(from, state) })
}

export const revisionRoutes = [
  { method: 'GET', path: '/drafts/:id/revisions', handler: listRevisions },
  { method: 'GET', path: '/drafts/:id/revisions/:seq', handler: getRevision }
]
