// Read the history of a draft (E273 task H5, #378): list the revisions, read one with its diff. Restore a revision
// (E273 task H6, #379): write its state as the new current state.
// Owner only, like GET /drafts/:id: a non-owner, an unknown draft and an unknown revision are all 404; a view-as
// caller is refused (403). The reads are one SQL statement after the session check (query budget: 2 per call).
// Draft text is in the answer for the owner and nowhere else. This file logs nothing except through logError, which
// never logs a message. The diff comes from the bounded src/utils/revisionDiff.js.
import { query } from '../db.js'
import { HttpError, json } from '../http.js'
import { requireUser } from '../session.js'
import { listBlobPrefix } from '../blob.js'
import { imageUrlsFrom, isOwnedBlobUrl } from '../draft-images.js'
import { logError } from '../log-error.js'
import { diffDrafts, summaryLine } from '../../src/utils/revisionDiff.js'
import { COLUMNS, etagHeaders, ifMatchOf, isUuid, notFound, refuseWhenViewing, staleResponse, tagOf } from './drafts.js'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100
const MAX_SEQ = 2147483647
const EMPTY = { title: '', posts: [] }

// The list summary reads only the structure of a diff (which posts changed, were added, removed or moved), never the
// words. So the statement swaps each post text for its md5 before the body leaves the database: equal texts stay equal
// and different ones stay different, and no long post is sent to Node or word-diffed. A body that is not an object with
// a string text is sent as it is.
const lightBody = (column) =>
  `case when jsonb_typeof(${column}) = 'object' and jsonb_typeof(${column}->'text') = 'string'
        then jsonb_set(${column}, '{text}', to_jsonb(md5(${column}->>'text'))) else ${column} end`

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
            (select coalesce(jsonb_object_agg(x.post_id, ${lightBody('x.body')}), '{}'::jsonb)
               from (select distinct on (post_id) post_id, body from draft_post_versions
                      where draft_id = $1 and seq < (select seq from low) order by post_id, seq desc) x
              where x.body is not null) as base_bodies,
            (select coalesce(jsonb_agg(jsonb_build_array(v.seq, v.post_id, ${lightBody('v.body')}, v.body is null)), '[]'::jsonb)
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
  let title = row.base_title
  let order = row.base_order
  const bodies = { ...(row.base_bodies ?? {}) }
  let previous = row.base_order === null && row.base_title === null ? EMPTY : stateOf(title, order, bodies)
  const items = []
  for (const rev of revisions) {
    for (const [postId, body, removed] of changesBySeq.get(rev.seq) ?? []) {
      if (removed) delete bodies[postId]
      else bodies[postId] = body
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

// The state at a revision, in one statement, with the current draft (owned, published flag, version) in the same answer.
const RESTORE_READ = `with d as (select id, title, posts, version, is_published from drafts where id = $1 and user_id = $2),
      r as (select seq from draft_revisions where draft_id = $1 and seq = $3 and exists (select 1 from d))
 select exists (select 1 from d) as owned,
        exists (select 1 from r) as found,
        (select to_jsonb(d) from d) as draft,
        (select title from draft_revisions where draft_id = $1 and seq <= $3 and title is not null
          order by seq desc limit 1) as title,
        (select post_order from draft_revisions where draft_id = $1 and seq <= $3 and post_order is not null
          order by seq desc limit 1) as post_order,
        (select coalesce(jsonb_object_agg(x.post_id, x.body), '{}'::jsonb)
           from (select distinct on (post_id) post_id, body from draft_post_versions
                  where draft_id = $1 and seq <= $3 order by post_id, seq desc) x
          where x.body is not null) as bodies`

// The one write of a restore. The WHERE re-checks: owner, not published, the If-Match version, and that the state differs
// (a restore of the current state writes nothing). The actor is set here and only here: kind 'restore', the label. The
// trigger reads both once and never merges a restore into the revision before it.
const RESTORE_WRITE = `update drafts
    set title = $3,
        posts = $4::jsonb,
        version = version + 1,
        updated_at = now(),
        last_actor_kind = 'restore',
        last_label = $5
  where id = $1 and user_id = $2 and not is_published
    and ($6::int is null or version = $6::int)
    and not ($3::text = title and $4::jsonb = posts)
  returning ${COLUMNS}`

/**
 * The posts of a restore without the images whose file is gone. Only this user's own Blob files count (a URL
 * of another object, or not a Blob URL, is kept as it is). One listing of the user's draft folder, at most. If the
 * listing is cut off (truncated), nothing is dropped: an image missing from a partial listing may still exist.
 * A listing that fails is a 503 with nothing written.
 */
async function postsWithImagesThatExist(uid, posts) {
  const owned = imageUrlsFrom(posts).filter((url) => isOwnedBlobUrl(url, uid))
  if (owned.length === 0) return { posts, dropped: 0 }
  let listing
  try {
    listing = await listBlobPrefix(`drafts/${uid}/`)
  } catch (err) {
    logError('[revisions] restore: listing the image files failed', err)
    throw new HttpError(503, 'The image files could not be checked. Nothing was restored; try again.')
  }
  if (listing.truncated) return { posts, dropped: 0 }
  const present = new Set(listing.files.map((file) => file.url))
  let dropped = 0
  const kept = posts.map((post) => {
    if (!Array.isArray(post?.images)) return post
    const images = post.images.filter((image) => {
      const url = typeof image === 'string' ? image : image?.url
      const gone = typeof url === 'string' && isOwnedBlobUrl(url, uid) && !present.has(url)
      if (gone) dropped += 1
      return !gone
    })
    return images.length === post.images.length ? post : { ...post, images }
  })
  return { posts: kept, dropped }
}

/**
 * POST /api/drafts/:id/revisions/:seq/restore: writes the state at `seq` as the new current state (owner only). A new
 * version and a revision "Restored revision <seq>"; later revisions stay. A stale If-Match is 412 with the current draft
 * and nothing written; a published draft is 409. Restoring the current state is a 200 with no write. Answer:
 * { draft, restored_from, images_not_restored }. A view-as caller is refused by the router's write check (403).
 */
async function restoreRevision({ request, params }) {
  const session = await requireUser(request)
  if (!isUuid(params.id)) throw notFound()
  if (!/^\d+$/.test(params.seq) || Number(params.seq) > MAX_SEQ) throw notFound()
  const seq = Number(params.seq)
  const tag = tagOf(ifMatchOf(request))

  const { rows } = await query(RESTORE_READ, [params.id, session.uid, seq])
  const row = rows[0]
  if (!row?.owned || !row.found) throw notFound()
  if (row.draft.is_published) throw new HttpError(409, 'This draft is published. Duplicate it to edit.')
  const state = stateOf(row.title, row.post_order, row.bodies)
  const { posts, dropped } = await postsWithImagesThatExist(session.uid, state.posts)
  const label = `Restored revision ${seq}`
  const restored = { restored_from: seq, images_not_restored: dropped }

  // Like writeOrAnswer in drafts.js: the UPDATE first; when it writes nothing, the draft is read again to say why.
  for (let attempt = 1; ; attempt++) {
    const { rows: written } = await query(RESTORE_WRITE, [params.id, session.uid, state.title, JSON.stringify(posts), label, tag])
    if (written[0]) return json({ draft: written[0], ...restored }, 200, etagHeaders(written[0].version))
    const { rows: found } = await query(
      `select ${COLUMNS}, ($3::text = title and $4::jsonb = posts) as same
         from drafts where id = $1 and user_id = $2`,
      [params.id, session.uid, state.title, JSON.stringify(posts)]
    )
    if (!found[0]) throw notFound()
    const { same, ...draft } = found[0]
    if (draft.is_published) throw new HttpError(409, 'This draft is published. Duplicate it to edit.')
    if (same) return json({ draft, ...restored }, 200, etagHeaders(draft.version))
    // A tag was sent, or this was the third try: a stale answer. Without a tag, the UPDATE is retried.
    if (tag !== null || attempt >= 3) return staleResponse(draft)
  }
}

export const revisionRoutes = [
  { method: 'GET', path: '/drafts/:id/revisions', handler: listRevisions },
  { method: 'GET', path: '/drafts/:id/revisions/:seq', handler: getRevision },
  { method: 'POST', path: '/drafts/:id/revisions/:seq/restore', handler: restoreRevision }
]
