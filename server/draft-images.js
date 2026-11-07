const BLOB_HOST_SUFFIX = '.public.blob.vercel-storage.com'

// Production recognises public Vercel Blob URLs. The local dev server registers its own
// key function through setBlobImpl (see server/blob.js).
let customKey = null

/** Tests and the local dev server only: replace how a URL maps to a Blob storage key. */
export function setBlobKeyFunction(fn) {
  customKey = fn
}

/** The storage key (e.g. `drafts/<uid>/<draft>/<file>`) for a Blob URL, or null if not one. */
export function blobKey(url) {
  if (customKey) return customKey(url)
  try {
    const { hostname, protocol, pathname } = new URL(url)
    if (protocol !== 'https:' || !hostname.endsWith(BLOB_HOST_SUFFIX)) return null
    return pathname.slice(1)
  } catch {
    return null
  }
}

/** True when the URL points at a Blob object this app manages. */
export function isBlobUrl(url) {
  return blobKey(url) !== null
}

/** True when the Blob object sits under this user's own `drafts/<uid>/` prefix. */
export function isOwnedBlobUrl(url, uid) {
  const key = blobKey(url)
  return key !== null && key.startsWith(`drafts/${uid}/`)
}

/** Every image URL referenced by a draft's posts (string entries and `{ url }` entries). */
export function imageUrlsFrom(posts) {
  if (!Array.isArray(posts)) return []
  return posts
    .flatMap((post) => (Array.isArray(post?.images) ? post.images : []))
    .map((img) => (typeof img === 'string' ? img : img?.url))
    .filter((url) => typeof url === 'string' && url.length > 0)
}
