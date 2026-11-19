// The one image host a view may load (plan Task 1 step 3, D4). It comes from the store id part of
// BLOB_READ_WRITE_TOKEN (`vercel_blob_rw_<storeId>_<secret>`), the same rule the Blob SDK uses. The store id
// is public (it is in every image URL); the token is never logged, thrown or returned here.
// T10 part 3 (#238): the origin is also baked into each view's HTML, so the images show even when a host drops
// the tool's _meta. Only a value that passes BLOB_ORIGIN_PATTERN is ever used; the environment decides it.
const BLOB_SUFFIX = '.public.blob.vercel-storage.com'
export const BLOB_ORIGIN_PATTERN = /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com$/

/** True when v is `https://<store>.public.blob.vercel-storage.com` (lowercase store id). */
export function isBlobOrigin(v) {
  return typeof v === 'string' && BLOB_ORIGIN_PATTERN.test(v)
}

/** `https://<store>.public.blob.vercel-storage.com`, or null when the store id is unknown or malformed. */
export function blobOrigin(env = process.env) {
  const token = env.BLOB_READ_WRITE_TOKEN
  if (typeof token !== 'string' || token === '') return null
  const [, , , raw = ''] = token.split('_')
  const id = raw.toLowerCase()
  const candidate = /^[a-z0-9]+$/.test(id) ? `https://${id}${BLOB_SUFFIX}` : null
  return isBlobOrigin(candidate) ? candidate : null
}

/**
 * A value written into a view's script as a JavaScript literal: the origin (only when it passes isBlobOrigin, else
 * null), JSON-encoded with the characters that could end a script tag or break a string escaped. It cannot carry a draft.
 */
export function embedOrigin(v) {
  return JSON.stringify(isBlobOrigin(v) ? v : null)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}
