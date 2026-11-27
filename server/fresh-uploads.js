// Files this process stored a moment ago (#419). The bytes path of add_image_from_url uploads a file through POST /images and
// attaches it through POST /drafts/:id/images: that route skips the fetch only for a file listed here, never for a url that merely
// looks like one of ours (any Blob store has the same host suffix). A file is used once. In memory: another instance does not know it
// and fetches the url as for any other.
const FRESH = new Map()
const MAX_FRESH = 500

const keyOf = (uid, url) => `${uid} ${url}`

export function rememberFresh(uid, url) {
  FRESH.set(keyOf(uid, url), true)
  if (FRESH.size > MAX_FRESH) FRESH.delete(FRESH.keys().next().value)
}

/** True once for a file this process stored for this user. */
export function takeFresh(uid, url) {
  return FRESH.delete(keyOf(uid, url))
}
