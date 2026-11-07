import { query } from '../db.js'
import { HttpError, json, readJson } from '../http.js'
import { requireUser } from '../session.js'
import { deleteBlobUrls, putBlob } from '../blob.js'
import { isBlobUrl } from '../draft-images.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_BYTES = 4 * 1024 * 1024 // Vercel's request body limit is 4.5 MB

function extensionFor(mime) {
  const subtype = mime.split('/')[1]?.split('+')[0] ?? ''
  return subtype.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 10) || 'bin'
}

/** POST /api/images?draftId=<uuid>: raw image bytes, owner of the draft only. */
export async function uploadImage({ request, url }) {
  const session = await requireUser(request)
  const draftId = url.searchParams.get('draftId')
  if (!draftId || !UUID_RE.test(draftId)) throw new HttpError(404, 'Draft not found')

  const { rows } = await query('select 1 from drafts where id = $1 and user_id = $2', [draftId, session.uid])
  if (!rows[0]) throw new HttpError(404, 'Draft not found')

  const mime = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (!mime.startsWith('image/')) throw new HttpError(415, 'Only image uploads are allowed')
  if (Number(request.headers.get('content-length') || 0) > MAX_BYTES) {
    throw new HttpError(413, 'Image must be 4 MB or smaller')
  }

  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength > MAX_BYTES) throw new HttpError(413, 'Image must be 4 MB or smaller')
  if (bytes.byteLength === 0) throw new HttpError(400, 'Empty upload')

  const pathname = `drafts/${session.uid}/${draftId}/${crypto.randomUUID()}.${extensionFor(mime)}`
  const blob = await putBlob(pathname, bytes, { contentType: mime })
  return json({ url: blob.url }, 201)
}

/** DELETE /api/images with `{ url }`: only objects under the caller's own prefix. */
export async function deleteImage({ request }) {
  const session = await requireUser(request)
  const body = await readJson(request, 10_000)
  const target = typeof body?.url === 'string' ? body.url : ''

  let pathname
  try {
    pathname = new URL(target).pathname
  } catch {
    throw new HttpError(400, 'Invalid image URL')
  }
  if (!isBlobUrl(target) || !pathname.startsWith(`/drafts/${session.uid}/`)) {
    throw new HttpError(403, 'Not allowed to delete this image')
  }

  await deleteBlobUrls([target])
  return json({ ok: true })
}

export const imageRoutes = [
  { method: 'POST', path: '/images', handler: uploadImage },
  { method: 'DELETE', path: '/images', handler: deleteImage }
]
