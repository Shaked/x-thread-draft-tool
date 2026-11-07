import { put, del } from '@vercel/blob'
import { isBlobUrl } from './draft-images.js'

/** Uploads a public image. The random suffix keeps every object URL unique. */
export function putBlob(pathname, body, { contentType }) {
  return put(pathname, body, { access: 'public', contentType, addRandomSuffix: true })
}

/**
 * Deletes Blob objects by URL. Ignores URLs that are not Blob URLs and never throws:
 * a failed delete must not block the database change that follows it.
 */
export async function deleteBlobUrls(urls) {
  const blobUrls = urls.filter(isBlobUrl)
  if (blobUrls.length === 0) return
  try {
    await del(blobUrls)
  } catch (error) {
    console.error('[blob] delete failed', error)
  }
}
