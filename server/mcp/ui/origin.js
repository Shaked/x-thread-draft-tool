// The one image host a view may load (plan Task 1 step 3, D4). It comes from the store id part of
// BLOB_READ_WRITE_TOKEN (`vercel_blob_rw_<storeId>_<secret>`), the same rule the Blob SDK uses. The store id
// is public (it is in every image URL); the token is never logged, thrown or returned here.
const BLOB_SUFFIX = '.public.blob.vercel-storage.com'

/** `https://<store>.public.blob.vercel-storage.com`, or null when the store id is unknown or malformed. */
export function blobOrigin(env = process.env) {
  const token = env.BLOB_READ_WRITE_TOKEN
  if (typeof token !== 'string' || token === '') return null
  const [, , , raw = ''] = token.split('_')
  const id = raw.toLowerCase()
  return /^[a-z0-9]+$/.test(id) ? `https://${id}${BLOB_SUFFIX}` : null
}
