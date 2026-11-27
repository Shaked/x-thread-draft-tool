// One REST route per post or image edit (#412). Each reads the draft, checks the rules and writes with one
// UPDATE that re-checks the version it read. An If-Match with a stale version is a 412 with no write; a published draft is
// a 409. The MCP tools call these routes in-process and keep their texts.
import { isDeepStrictEqual } from 'node:util'
import { query } from '../db.js'
import { HttpError, json, readJson } from '../http.js'
import { requireUser } from '../session.js'
import { deleteBlobUrls } from '../blob.js'
import { isOwnedBlobUrl } from '../draft-images.js'
import { xLength } from '../../src/utils/xLength.js'
import { COLUMNS, etagHeaders, ifMatchOf, isUuid, preconditionHolds, staleResponse, usedImageUrls } from './drafts.js'
import { storeRemoteImage } from './images.js'

export const MAX_IMAGES = 4
export const PUBLISHED_ERROR = 'This draft is published. Duplicate it to edit.'
const IMAGE_NOT_FOUND = 'Image not found in this draft. Its posts and image urls are in get_draft_outline.'
// A write loses a round to any other write of the draft. Parallel image adds make at most 4 writes per post (#367).
const attemptsFor = (posts) => Math.max(8, 4 * posts.length + 1)
export const POST_NOT_FOUND = 'Post not found in this draft'
const REMOVE_IMAGE_ARGS = 'Give url to remove one image, or post_id to remove every image of that post.'

/** The draft as it was before an edit, on the Response of the route (only an in-process caller reads it; #405). */
export const DRAFT_BEFORE = Symbol('draft before an edit')

export const fullPostError = (index) => `Post ${index + 1} already has ${MAX_IMAGES} images. Remove, replace or move one first.`
const imageUrlOf = (image) => (typeof image === 'string' ? image : image?.url)
const postImageUrls = (post) => (post.images ?? []).map(imageUrlOf).filter((url) => typeof url === 'string' && url.length > 0)
const failure = (error, status = 422) => ({ error, status })
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** A draft saved before ids were required can hold a post with no id: the edit gives it one first. */
const withMissingPostIds = (posts) => posts.map((post) => (isObject(post) && typeof post.id !== 'string' ? { ...post, id: crypto.randomUUID() } : post))

function indexOfPost(posts, postId) {
  const index = posts.findIndex((post) => post.id === postId)
  return index < 0 ? failure(POST_NOT_FOUND) : index
}

function body400(condition, message) {
  if (!condition) throw new HttpError(400, message)
}

function validText(text) {
  body400(typeof text === 'string' && text.length <= 4000 && xLength(text) <= 280, 'text must be a string of at most 280 characters as X counts them')
  return text
}

const validPosition = (position, required) => {
  if (position === undefined && !required) return undefined
  body400(Number.isInteger(position) && position >= 1, 'position must be a whole number from 1')
  return position
}

/**
 * The one write of every edit. `plan(posts)` answers { posts, removedImages?, extra? } or a failure ({ error, status }).
 * It reads the draft, checks, then writes with one UPDATE that re-checks the version it read, so it never overwrites
 * a newer write. A change that leaves the posts as they are is a 200 with no write (a replay). With If-Match, a
 * version that is not the current one is a 412 with no write; without it the edit is planned again on the newer draft.
 * Images that only the removed posts or images used are deleted after the write, when they are the caller's own
 * and no draft still uses them.
 */
async function editPosts(request, id, plan, { expected = ifMatchOf(request) } = {}) {
  return editPostsAs(await requireUser(request), id, plan, { expected })
}

/** The same write for a caller that is already known (a one-time upload link names its owner: #418). */
export async function editPostsAs(session, id, plan, { expected = null } = {}) {
  if (!isUuid(id)) throw new HttpError(404, 'Draft not found')
  for (let attempt = 1; ; attempt += 1) {
    const { rows } = await query(`select ${COLUMNS} from drafts where id = $1 and user_id = $2`, [id, session.uid])
    if (!rows[0]) throw new HttpError(404, 'Draft not found')
    const draft = rows[0]
    if (draft.is_published) throw new HttpError(409, PUBLISHED_ERROR)
    const posts = withMissingPostIds(draft.posts)
    const planned = plan(posts, draft)
    if (planned.error) throw new HttpError(planned.status, planned.error)
    // Same rule as PATCH /drafts/:id: a post that is not an object with an id is never written back.
    body400(planned.posts.every((post) => isObject(post) && typeof post.id === 'string'), 'each post must be an object with a string id')
    const answer = (saved, extra) => {
      const res = json({ draft: saved, ...extra }, 200, etagHeaders(saved.version))
      res[DRAFT_BEFORE] = { ...draft, posts }
      return res
    }
    // Files that no draft uses any more are deleted after the write. An error here never undoes a saved edit.
    const cleanUp = async () => {
      try {
        const owned = (planned.removedImages ?? []).filter((url) => isOwnedBlobUrl(url, session.uid))
        const used = await usedImageUrls(query, session.uid, owned, null)
        const doomed = owned.filter((url) => !used.has(url))
        if (doomed.length) await deleteBlobUrls(doomed)
        return doomed.length
      } catch (err) {
        console.error('[draft-edits] file cleanup failed', err)
        return 0
      }
    }
    if (isDeepStrictEqual(planned.posts, draft.posts)) {
      // A replay writes nothing, but still deletes the file a first call may have left behind.
      const deleted = await cleanUp()
      return answer(draft, { ...planned.extra, ...(planned.countDeleted ? { deleted } : {}) })
    }
    if (!preconditionHolds(expected, draft.version)) return staleResponse(draft)
    const { rows: saved } = await query(
      `update drafts set posts = $3::jsonb, version = version + 1, updated_at = now()
        where id = $1 and user_id = $2 and version = $4::int and not is_published
        returning ${COLUMNS}`,
      [id, session.uid, JSON.stringify(planned.posts), draft.version]
    )
    if (!saved[0]) {
      // Another write landed between the read and this UPDATE. Read again; the loop ends in a 412 or the new plan.
      if (attempt >= attemptsFor(posts)) return staleResponse(draft)
      continue
    }
    const deleted = await cleanUp()
    return answer(saved[0], { ...planned.extra, ...(planned.countDeleted ? { deleted } : {}) })
  }
}

/** POST /api/drafts/:id/posts { text, after_post_id?, post_id? }: adds one post, last or right after another. */
async function addPost({ request, params }) {
  const body = await readJson(request)
  body400(isObject(body), 'Body must be a JSON object')
  validText(body.text)
  body400(body.post_id === undefined || (typeof body.post_id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(body.post_id)), 'post_id must be 1 to 100 letters, digits, _ or -')
  body400(body.after_post_id === undefined || typeof body.after_post_id === 'string', 'after_post_id must be a string')
  return editPosts(request, params.id, (posts) => {
    const existing = body.post_id === undefined ? undefined : posts.find((post) => post.id === body.post_id)
    if (existing) return existing.text === body.text ? { posts } : failure('A post with this post_id already exists with different text.', 409)
    const post = { id: body.post_id ?? crypto.randomUUID(), text: body.text, images: [], embeddedTweet: null }
    if (body.after_post_id === undefined) return { posts: [...posts, post] }
    const index = posts.findIndex((p) => p.id === body.after_post_id)
    if (index < 0) return failure('after_post_id is not a post in this draft')
    return { posts: [...posts.slice(0, index + 1), post, ...posts.slice(index + 1)] }
  })
}

/** DELETE /api/drafts/:id/posts/:postId: a draft keeps at least one post. Images only that post used are deleted. */
function removePost({ request, params }) {
  return editPosts(request, params.id, (posts) => {
    const index = indexOfPost(posts, params.postId)
    if (typeof index !== 'number') return index
    if (posts.length === 1) return failure('A draft keeps at least one post.')
    return { posts: posts.filter((_, i) => i !== index), removedImages: postImageUrls(posts[index]) }
  })
}

/** Moves the image `url` to post `toId` at `position`, from wherever it is. */
function moveImage(posts, url, toId, position) {
  const from = posts.findIndex((post) => postImageUrls(post).includes(url))
  if (from < 0) return failure(IMAGE_NOT_FOUND)
  const to = indexOfPost(posts, toId)
  if (typeof to !== 'number') return to
  const source = posts[from].images.slice()
  // splice, not filter: an older draft can hold the same plain url string twice; only one moves.
  const [image] = source.splice(source.findIndex((entry) => imageUrlOf(entry) === url), 1)
  const target = to === from ? source.slice() : (posts[to].images ?? []).slice()
  if (target.length >= MAX_IMAGES) return failure(fullPostError(to))
  if (position > target.length + 1) return failure(`position must be from 1 to ${target.length + 1}`)
  target.splice(position - 1, 0, image)
  return { posts: posts.map((post, i) => (i === to ? { ...post, images: target } : i === from ? { ...post, images: source } : post)) }
}

/** POST /api/drafts/:id/posts/:postId/move { position, image_url? }: moves the post, or with image_url that image to this post. */
async function movePost({ request, params }) {
  const body = await readJson(request)
  body400(isObject(body), 'Body must be a JSON object')
  const position = validPosition(body.position, true)
  body400(body.image_url === undefined || typeof body.image_url === 'string', 'image_url must be a string')
  return editPosts(request, params.id, (posts) => {
    if (body.image_url !== undefined) return moveImage(posts, body.image_url, params.postId, position)
    const index = indexOfPost(posts, params.postId)
    if (typeof index !== 'number') return index
    if (position > posts.length) return failure(`position must be from 1 to ${posts.length}`)
    const moved = posts.slice()
    const [post] = moved.splice(index, 1)
    moved.splice(position - 1, 0, post)
    return { posts: moved }
  })
}

/** DELETE /api/drafts/:id/images { url } or { post_id }: one image from every post that has it, or every image of one post. */
async function removeImages({ request, params }) {
  const body = await readJson(request, 10_000)
  if (!isObject(body) || (body.url === undefined) === (body.post_id === undefined)) throw new HttpError(422, REMOVE_IMAGE_ARGS)
  body400(typeof (body.url ?? body.post_id) === 'string', 'url and post_id must be strings')
  return editPosts(request, params.id, (posts) => {
    const index = body.url === undefined ? indexOfPost(posts, body.post_id) : null
    if (index !== null && typeof index !== 'number') return index
    const removed = index === null ? [body.url] : postImageUrls(posts[index])
    const keep = (post, i) => (index === null || i === index ? { ...post, images: (post.images ?? []).filter((image) => !removed.includes(imageUrlOf(image))) } : post)
    return { posts: posts.map(keep), removedImages: removed, countDeleted: true, extra: { removed: removed.length } }
  })
}

/**
 * POST /api/drafts/:id/images { url, post_id, position? } or { url, replace }: fetches the public image `url` and
 * adds it to a post (at position, default last, at most 4), or puts it where the image `replace` was in every post.
 * The old file is deleted when no draft uses it; on any failure the new file is deleted.
 */
async function addImage({ request, params }) {
  const session = await requireUser(request)
  const body = await readJson(request, 10_000)
  body400(isObject(body) && typeof body.url === 'string', 'url must be the address of a public image')
  body400((body.post_id === undefined) !== (body.replace === undefined), 'Give post_id to add the image to a post, or replace to swap an image, not both')
  body400(body.post_id === undefined || typeof body.post_id === 'string', 'post_id must be a string')
  body400(body.replace === undefined || typeof body.replace === 'string', 'replace must be a string')
  const position = validPosition(body.position, false)
  const expected = ifMatchOf(request)
  const plan = (url) => (posts) => {
    if (body.replace !== undefined) {
      if (!posts.some((post) => postImageUrls(post).includes(body.replace))) return failure(IMAGE_NOT_FOUND, 404)
      const swap = (image) => (imageUrlOf(image) === body.replace ? { url } : image)
      return { posts: posts.map((post) => ({ ...post, images: (post.images ?? []).map(swap) })), removedImages: [body.replace], extra: { url, replaced: body.replace } }
    }
    const index = posts.findIndex((post) => post.id === body.post_id)
    if (index < 0) return failure(POST_NOT_FOUND, 404)
    const images = (posts[index].images ?? []).slice()
    if (images.length >= MAX_IMAGES) return failure(fullPostError(index))
    if (position > images.length + 1) return failure(`position must be from 1 to ${images.length + 1}`)
    images.splice((position ?? images.length + 1) - 1, 0, { url })
    return { posts: posts.map((post, i) => (i === index ? { ...post, images } : post)), extra: { url } }
  }
  // The rules run once on the draft as it is, before the file is fetched, so a refused call fetches nothing.
  if (!isUuid(params.id)) throw new HttpError(404, 'Draft not found')
  const { rows } = await query(`select ${COLUMNS} from drafts where id = $1 and user_id = $2`, [params.id, session.uid])
  if (!rows[0]) throw new HttpError(404, 'Draft not found')
  if (rows[0].is_published) throw new HttpError(409, PUBLISHED_ERROR)
  const early = plan('pending')(withMissingPostIds(rows[0].posts))
  if (early.error) throw new HttpError(early.status, early.error)
  const { url } = await storeRemoteImage(session.uid, params.id, body.url)
  let response
  try {
    response = await editPosts(request, params.id, plan(url), { expected })
  } catch (err) {
    await deleteBlobUrls([url]).catch(() => {})
    throw err
  }
  if (response.status >= 400) await deleteBlobUrls([url]).catch(() => {})
  return response
}

export const draftEditRoutes = [
  { method: 'POST', path: '/drafts/:id/posts', handler: addPost, ci: true },
  { method: 'DELETE', path: '/drafts/:id/posts/:postId', handler: removePost, ci: true },
  { method: 'POST', path: '/drafts/:id/posts/:postId/move', handler: movePost, ci: true },
  { method: 'POST', path: '/drafts/:id/images', handler: addImage, ci: true },
  { method: 'DELETE', path: '/drafts/:id/images', handler: removeImages, ci: true }
]
