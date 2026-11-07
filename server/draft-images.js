const BLOB_HOST_SUFFIX = '.public.blob.vercel-storage.com'

/** True when the URL points at a public Vercel Blob object. */
export function isBlobUrl(url) {
  try {
    const { hostname, protocol } = new URL(url)
    return protocol === 'https:' && hostname.endsWith(BLOB_HOST_SUFFIX)
  } catch {
    return false
  }
}

/** True when the URL is a Blob object under this user's own `drafts/<uid>/` prefix. */
export function isOwnedBlobUrl(url, uid) {
  return isBlobUrl(url) && new URL(url).pathname.startsWith(`/drafts/${uid}/`)
}

/** Every image URL referenced by a draft's posts (string entries and `{ url }` entries). */
export function imageUrlsFrom(posts) {
  if (!Array.isArray(posts)) return []
  return posts
    .flatMap((post) => (Array.isArray(post?.images) ? post.images : []))
    .map((img) => (typeof img === 'string' ? img : img?.url))
    .filter((url) => typeof url === 'string' && url.length > 0)
}
