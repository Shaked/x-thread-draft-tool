import { query } from '../db.js'
import { HttpError, json, readJson } from '../http.js'
import { requireUser } from '../session.js'
import { deleteBlobUrls } from '../blob.js'
import { imageUrlsFrom, isOwnedBlobUrl } from '../draft-images.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COLUMNS = 'id, user_id, title, posts, is_published, published_at, created_at, updated_at'
const EMPTY_POST = () => ({ id: crypto.randomUUID(), text: '', images: [], embeddedTweet: null })

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value)
}

function requireObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Body must be a JSON object')
  }
  return body
}

function validTitle(title) {
  if (typeof title !== 'string' || title.length > 500) {
    throw new HttpError(400, 'title must be a string of at most 500 characters')
  }
  return title
}

function validPosts(posts) {
  if (!Array.isArray(posts)) throw new HttpError(400, 'posts must be an array')
  return posts
}

function notFound() {
  return new HttpError(404, 'Draft not found')
}

/** Loads a draft owned by `uid`, or throws 404. Used by every owner-only route. */
async function ownedPosts(id, uid) {
  if (!isUuid(id)) throw notFound()
  const { rows } = await query('select posts from drafts where id = $1 and user_id = $2', [id, uid])
  if (!rows[0]) throw notFound()
  return rows[0].posts
}

/**
 * Blob URLs that may be deleted with this draft: only the owner's own objects, and never an
 * object that another draft of the same owner still references (duplicates share URLs).
 */
async function deletableImageUrls(uid, id, posts) {
  const owned = imageUrlsFrom(posts).filter((url) => isOwnedBlobUrl(url, uid))
  if (owned.length === 0) return []
  const { rows } = await query('select posts from drafts where user_id = $1 and id <> $2', [uid, id])
  const stillUsed = new Set(rows.flatMap((row) => imageUrlsFrom(row.posts)))
  return owned.filter((url) => !stillUsed.has(url))
}

/** GET /api/drafts?published=true|false */
export async function listDrafts({ request, url }) {
  const session = await requireUser(request)
  const flag = url.searchParams.get('published')
  if (flag !== 'true' && flag !== 'false') throw new HttpError(400, 'published must be true or false')
  const published = flag === 'true'
  const order = published ? 'published_at desc' : 'updated_at desc'
  const { rows } = await query(
    `select ${COLUMNS} from drafts where user_id = $1 and is_published = $2 order by ${order}`,
    [session.uid, published]
  )
  return json({ drafts: rows })
}

/** POST /api/drafts */
export async function createDraft({ request }) {
  const session = await requireUser(request)
  const body = requireObject(await readJson(request))
  const title = body.title === undefined ? '' : validTitle(body.title)
  const posts = body.posts === undefined ? [EMPTY_POST()] : validPosts(body.posts)
  const { rows } = await query(
    `insert into drafts (user_id, title, posts) values ($1, $2, $3::jsonb) returning ${COLUMNS}`,
    [session.uid, title, JSON.stringify(posts)]
  )
  return json({ draft: rows[0] }, 201)
}

/** GET /api/drafts/:id is the only public draft read (share-by-link). */
export async function getDraft({ params }) {
  if (!isUuid(params.id)) throw notFound()
  const { rows } = await query(`select ${COLUMNS} from drafts where id = $1`, [params.id])
  if (!rows[0]) throw notFound()
  return json({ draft: rows[0] })
}

/** PATCH /api/drafts/:id: owner only; a non-owner gets 404 and the row is untouched. */
export async function updateDraft({ request, params }) {
  const session = await requireUser(request)
  const body = requireObject(await readJson(request))
  if (body.title === undefined && body.posts === undefined) {
    throw new HttpError(400, 'Nothing to update')
  }
  const title = body.title === undefined ? null : validTitle(body.title)
  const posts = body.posts === undefined ? null : JSON.stringify(validPosts(body.posts))
  if (!isUuid(params.id)) throw notFound()

  const { rows } = await query(
    `update drafts
        set title = coalesce($3, title),
            posts = coalesce($4::jsonb, posts),
            updated_at = now()
      where id = $1 and user_id = $2
      returning ${COLUMNS}`,
    [params.id, session.uid, title, posts]
  )
  if (!rows[0]) throw notFound()
  return json({ draft: rows[0] })
}

/** POST /api/drafts/:id/publish: deletes the draft's Blob images and clears them from posts. */
export async function publishDraft({ request, params }) {
  const session = await requireUser(request)
  const posts = await ownedPosts(params.id, session.uid)
  await deleteBlobUrls(await deletableImageUrls(session.uid, params.id, posts))
  const cleaned = posts.map((post) => ({ ...post, images: [] }))

  const { rows } = await query(
    `update drafts
        set posts = $3::jsonb,
            is_published = true,
            published_at = now(),
            updated_at = now()
      where id = $1 and user_id = $2
      returning ${COLUMNS}`,
    [params.id, session.uid, JSON.stringify(cleaned)]
  )
  if (!rows[0]) throw notFound()
  return json({ draft: rows[0] })
}

/** DELETE /api/drafts/:id */
export async function deleteDraft({ request, params }) {
  const session = await requireUser(request)
  const posts = await ownedPosts(params.id, session.uid)
  await deleteBlobUrls(await deletableImageUrls(session.uid, params.id, posts))
  await query('delete from drafts where id = $1 and user_id = $2', [params.id, session.uid])
  return json({ ok: true })
}

/** POST /api/drafts/:id/share-tokens: one-time token for the X-thread or agent link. */
export async function createShareToken({ request, params }) {
  const session = await requireUser(request)
  if (!isUuid(params.id)) throw notFound()
  const { rows } = await query(
    `insert into share_tokens (draft_id, created_by)
     select $1::uuid, $2::uuid
      where exists (select 1 from drafts where id = $1::uuid and user_id = $2::uuid)
     returning token`,
    [params.id, session.uid]
  )
  if (!rows[0]) throw notFound()
  return json({ token: rows[0].token }, 201)
}

export const draftRoutes = [
  { method: 'GET', path: '/drafts', handler: listDrafts },
  { method: 'POST', path: '/drafts', handler: createDraft },
  { method: 'GET', path: '/drafts/:id', handler: getDraft },
  { method: 'PATCH', path: '/drafts/:id', handler: updateDraft },
  { method: 'POST', path: '/drafts/:id/publish', handler: publishDraft },
  { method: 'DELETE', path: '/drafts/:id', handler: deleteDraft },
  { method: 'POST', path: '/drafts/:id/share-tokens', handler: createShareToken }
]
