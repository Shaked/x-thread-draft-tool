import { query } from '../db.js'
import { HttpError, json, readJson } from '../http.js'
import { requireUser } from '../session.js'
import { deleteBlobUrls, putBlob } from '../blob.js'
import { isOwnedBlobUrl } from '../draft-images.js'
import { usedImageUrls } from './drafts.js'
import { fetchRemoteImage } from '../remote-image.js'
import { prepareImage } from '../image-safety.js'
import { recordImage } from '../image-ledger.js'
import { rememberFresh } from '../fresh-uploads.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MAX_BYTES = 4 * 1024 * 1024 // Vercel's request body limit is 4.5 MB

const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

/** Checks the bytes (type from the first bytes, metadata removed), stores them and counts them for the user. */
export async function storeChecked(uid, draftId, raw) {
  const { bytes, contentType } = prepareImage(raw)
  const pathname = `drafts/${uid}/${draftId}/${crypto.randomUUID()}.${EXTENSIONS[contentType]}`
  const blob = await putBlob(pathname, bytes, { contentType })
  await recordImage(uid, blob.url, bytes.byteLength)
  rememberFresh(uid, blob.url)
  return blob.url
}

/** POST /api/images?draftId=<uuid>: raw image bytes, owner of the draft only. */
async function uploadImage({ request, url }) {
  const session = await requireUser(request)
  const draftId = url.searchParams.get('draftId')
  if (!draftId || !UUID_RE.test(draftId)) throw new HttpError(404, 'Draft not found')

  const { rows } = await query('select 1 from drafts where id = $1 and user_id = $2', [draftId, session.uid])
  if (!rows[0]) throw new HttpError(404, 'Draft not found')

  if (Number(request.headers.get('content-length') || 0) > MAX_BYTES) {
    throw new HttpError(413, 'Image must be 4 MB or smaller')
  }

  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength > MAX_BYTES) throw new HttpError(413, 'Image must be 4 MB or smaller')
  if (bytes.byteLength === 0) throw new HttpError(400, 'Empty upload')

  return json({ url: await storeChecked(session.uid, draftId, bytes) }, 201)
}

/**
 * DELETE /api/images with `{ url }`: only objects under the caller's own prefix. With
 * `if_unused: true` the file is deleted only when no draft of the caller still uses it; the answer
 * then says whether it was deleted. Without it (or with false) the answer is `{ ok: true }`, as before.
 */
async function deleteImage({ request }) {
  const session = await requireUser(request)
  const body = await readJson(request, 10_000)
  const target = typeof body?.url === 'string' ? body.url : ''
  const ifUnused = body?.if_unused

  if (!/^https?:\/\//.test(target)) throw new HttpError(400, 'Invalid image URL')
  if (!isOwnedBlobUrl(target, session.uid)) {
    throw new HttpError(403, 'Not allowed to delete this image')
  }
  if (ifUnused !== undefined && typeof ifUnused !== 'boolean') throw new HttpError(400, 'if_unused must be true or false')

  if (ifUnused === true) {
    if ((await usedImageUrls(query, session.uid, [target], null)).has(target)) return json({ ok: true, deleted: false })
    await deleteBlobUrls([target])
    return json({ ok: true, deleted: true })
  }
  await deleteBlobUrls([target])
  return json({ ok: true })
}

/** POST /api/images/from-url { draftId, url }: the server fetches the image (owner only). */
async function uploadImageFromUrl({ request }) {
  const session = await requireUser(request)
  const body = await readJson(request, 10_000)
  const draftId = typeof body?.draftId === 'string' ? body.draftId : ''
  if (!UUID_RE.test(draftId)) throw new HttpError(404, 'Draft not found')
  const { rows } = await query('select 1 from drafts where id = $1 and user_id = $2', [draftId, session.uid])
  if (!rows[0]) throw new HttpError(404, 'Draft not found')

  return json(await storeRemoteImage(session.uid, draftId, body.url), 201)
}

/** Fetches a public image and stores it under the caller's own prefix. Answers { url, sourceUrl }. */
export async function storeRemoteImage(uid, draftId, sourceUrl) {
  const { bytes } = await fetchRemoteImage(sourceUrl)
  return { url: await storeChecked(uid, draftId, bytes), sourceUrl }
}

export const imageRoutes = [
  { method: 'POST', path: '/images', handler: uploadImage, ci: true },
  { method: 'POST', path: '/images/from-url', handler: uploadImageFromUrl, ci: true },
  { method: 'DELETE', path: '/images', handler: deleteImage, ci: true }
]
