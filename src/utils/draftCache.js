import { delMany, keys } from 'idb-keyval'

/**
 * Deletes every draft copy the editor cached in this browser (IndexedDB `draft-<id>`). Called at sign-out
 * and whenever the app finds nobody signed in, so a session that ended any other way (the consent page's
 * "Not you? Sign out", an expired or revoked cookie) leaves no draft text behind. Never throws: a blocked
 * IndexedDB must not block anything.
 */
export async function clearCachedDrafts() {
  try {
    const cached = (await keys()).filter((key) => typeof key === 'string' && key.startsWith('draft-'))
    if (cached.length > 0) await delMany(cached)
  } catch (err) {
    console.error('Clearing cached drafts failed:', err)
  }
}
