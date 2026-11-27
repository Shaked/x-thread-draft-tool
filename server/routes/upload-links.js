// One-time upload links (#418, plan docs/plans/chat-image-upload.md 4.2). The owner asks for a link for one post;
// whoever holds the link (a phone, another computer) adds up to the free slots of that post, without signing in.
// The token is the credential: 32 random bytes, only the hash is stored, and it travels in the URL fragment
// (never in a path) and in the Authorization header of the upload.
import { createHash, randomBytes } from 'node:crypto'
import { query } from '../db.js'
import { HttpError, json } from '../http.js'
import { requireUser } from '../session.js'
import { deleteBlobUrls } from '../blob.js'
import { COLUMNS, isUuid } from './drafts.js'
import { MAX_BYTES, storeChecked } from './images.js'
import { MAX_IMAGES, POST_NOT_FOUND, PUBLISHED_ERROR, editPostsAs, fullPostError } from './draft-edits.js'

const LINK_MINUTES = 30
const LINKS_PER_HOUR = 10
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/
const GONE_TEXT = 'This link has expired or was already used.'
const RATE_TEXT = `At most ${LINKS_PER_HOUR} upload links per hour. Try again later.`

const hashOf = (token) => createHash('sha256').update(token).digest('hex')
const gone = () => new HttpError(410, GONE_TEXT)

/** Deletes links that expired more than a day ago (the hour of rate counting needs the recent ones). Best effort. */
async function cleanupUploadLinks() {
  try {
    await query(`delete from image_upload_links where expires_at < now() - interval '1 day'`)
  } catch (err) {
    console.error('[upload-links] cleanup failed', err)
  }
}

/** POST /api/drafts/:id/posts/:postId/upload-links: a link for the free slots of one post (owner only). */
async function createUploadLink({ request, params }) {
  const session = await requireUser(request)
  if (session.viewAs) throw new HttpError(403, `Viewing as ${session.login}: credentials are not available. End viewing first.`)
  if (!isUuid(params.id)) throw new HttpError(404, 'Draft not found')
  const { rows } = await query(`select ${COLUMNS} from drafts where id = $1 and user_id = $2`, [params.id, session.uid])
  const draft = rows[0]
  if (!draft) throw new HttpError(404, 'Draft not found')
  if (draft.is_published) throw new HttpError(409, PUBLISHED_ERROR)
  const index = draft.posts.findIndex((post) => post?.id === params.postId)
  if (index < 0) throw new HttpError(404, POST_NOT_FOUND)
  const slots = MAX_IMAGES - (draft.posts[index].images ?? []).length
  if (slots < 1) throw new HttpError(422, fullPostError(index))

  const token = randomBytes(32).toString('base64url')
  // The count and the insert are one statement, so parallel calls cannot pass the limit together.
  const inserted = await query(
    `insert into image_upload_links (user_id, draft_id, post_id, token_hash, slots, expires_at)
     select $1, $2, $3, $4, $5, now() + make_interval(mins => $6)
      where (select count(*) from image_upload_links where user_id = $1 and created_at > now() - interval '1 hour') < $7
     returning expires_at`,
    [session.uid, draft.id, params.postId, hashOf(token), slots, LINK_MINUTES, LINKS_PER_HOUR]
  )
  if (!inserted.rows[0]) throw new HttpError(429, RATE_TEXT)
  await cleanupUploadLinks()

  const origin = (process.env.PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '')
  return json(
    {
      url: `${origin}/upload#${token}`,
      draftId: draft.id,
      postId: params.postId,
      post: index + 1,
      slots,
      expires_at: new Date(inserted.rows[0].expires_at).toISOString()
    },
    201
  )
}

function bearerToken(request) {
  const match = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '')
  return match && TOKEN_SHAPE.test(match[1]) ? match[1] : null
}

/** Gives a claimed slot back (the upload failed). Never throws: a missed release only costs the holder one slot. */
async function release(id) {
  try {
    await query('update image_upload_links set used = used - 1 where id = $1 and used > 0', [id])
  } catch (err) {
    console.error('[upload-links] release failed', err)
  }
}

/** GET /api/upload-links: what the page shows for its link: the post number and the free slots. Never the draft title or text. */
async function readUploadLink({ request }) {
  const token = bearerToken(request)
  if (!token) throw gone()
  const { rows } = await query(
    `select l.post_id, l.slots - l.used as remaining, l.expires_at, d.posts
       from image_upload_links l join drafts d on d.id = l.draft_id join users u on u.id = l.user_id
      where l.token_hash = $1 and l.used < l.slots and l.expires_at > now() and not d.is_published and u.suspended_at is null`,
    [hashOf(token)]
  )
  const index = rows[0] ? rows[0].posts.findIndex((post) => post?.id === rows[0].post_id) : -1
  if (index < 0) throw gone()
  return json({ post: index + 1, remaining: rows[0].remaining, expires_at: new Date(rows[0].expires_at).toISOString() })
}

/**
 * POST /api/upload-links/images: raw image bytes, `Authorization: Bearer <token>`. A slot is claimed in one
 * statement that also checks expiry, the draft (there, not published) and the owner (not suspended); it is given
 * back when the upload or the attach fails. A dead link answers 410 with the share route's wording.
 */
async function uploadViaLink({ request }) {
  const token = bearerToken(request)
  if (!token) throw gone()
  const claimed = await query(
    `update image_upload_links l set used = used + 1
      where l.token_hash = $1 and l.used < l.slots and l.expires_at > now()
        and exists (select 1 from drafts d join users u on u.id = d.user_id
                     where d.id = l.draft_id and not d.is_published and u.suspended_at is null)
      returning l.id, l.user_id, l.draft_id, l.post_id, l.slots, l.used`,
    [hashOf(token)]
  )
  const link = claimed.rows[0]
  if (!link) throw gone()

  let url = null
  try {
    if (Number(request.headers.get('content-length') || 0) > MAX_BYTES) throw new HttpError(413, 'Image must be 4 MB or smaller')
    const bytes = new Uint8Array(await request.arrayBuffer())
    if (bytes.byteLength > MAX_BYTES) throw new HttpError(413, 'Image must be 4 MB or smaller')
    if (bytes.byteLength === 0) throw new HttpError(400, 'Empty upload')
    url = await storeChecked(link.user_id, link.draft_id, bytes)

    const plan = (posts) => {
      const index = posts.findIndex((post) => post.id === link.post_id)
      if (index < 0) return { error: GONE_TEXT, status: 410 }
      const images = posts[index].images ?? []
      if (images.length >= MAX_IMAGES) return { error: fullPostError(index), status: 422 }
      return { posts: posts.map((post, i) => (i === index ? { ...post, images: [...images, { url }] } : post)) }
    }
    // The #370 retry loop re-reads on a lost round; no If-Match, so a concurrent edit is never overwritten (#354).
    const res = await editPostsAs({ uid: link.user_id }, link.draft_id, plan)
    if (res.status >= 400) throw new HttpError(res.status, 'The draft changed while uploading. Try again.')
    return json({ url, remaining: link.slots - link.used }, 201)
  } catch (err) {
    if (url) await deleteBlobUrls([url]).catch(() => {})
    await release(link.id)
    // A draft that became published, or a post that was removed, is a dead link.
    if (err instanceof HttpError && (err.status === 409 || err.status === 404)) throw gone()
    throw err
  }
}

export const uploadLinkRoutes = [
  { method: 'GET', path: '/upload-links', handler: readUploadLink },
  { method: 'POST', path: '/drafts/:id/posts/:postId/upload-links', handler: createUploadLink },
  { method: 'POST', path: '/upload-links/images', handler: uploadViaLink }
]
