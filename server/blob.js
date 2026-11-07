import { put, del } from '@vercel/blob'
import { setBlobKeyFunction, isBlobUrl } from './draft-images.js'

// The Vercel Blob implementation by default. The local dev server swaps in a filesystem one.
let impl = {
  put: (pathname, body, options) => put(pathname, body, options),
  del: (urls) => del(urls)
}

/** Replaces the storage backend. `key(url)` maps a URL to its storage key, or null. */
export function setBlobImpl(next) {
  impl = next
  setBlobKeyFunction(next.key ?? null)
}

/** Uploads a public image. The random suffix keeps every object URL unique. */
export function putBlob(pathname, body, { contentType }) {
  return impl.put(pathname, body, { access: 'public', contentType, addRandomSuffix: true })
}

/**
 * Deletes Blob objects by URL. Ignores URLs that are not managed Blob URLs and never throws:
 * a failed delete must not block the database change that follows it.
 */
export async function deleteBlobUrls(urls) {
  const blobUrls = urls.filter(isBlobUrl)
  if (blobUrls.length === 0) return
  try {
    await impl.del(blobUrls)
  } catch (error) {
    console.error('[blob] delete failed', error)
  }
}
