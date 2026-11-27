import { query } from './db.js'

/** Remembers the bytes of an uploaded image for its owner (#416). Never throws: a missed row only under-counts. */
export async function recordImage(uid, url, bytes) {
  try {
    await query('insert into image_files (url, user_id, bytes) values ($1, $2, $3) on conflict (url) do nothing', [url, uid, bytes])
  } catch (error) {
    console.error('[image-ledger] record failed', error)
  }
}

/** Lowers the totals when image files are deleted. Never throws. */
export async function forgetImages(urls) {
  if (urls.length === 0) return
  try {
    await query('delete from image_files where url = any($1::text[])', [urls])
  } catch (error) {
    console.error('[image-ledger] forget failed', error)
  }
}

/** One user's stored image bytes, from the database. */
export async function storedBytes(uid) {
  const { rows } = await query('select coalesce(sum(bytes), 0)::bigint as total, count(*)::int as files from image_files where user_id = $1', [uid])
  return { stored_bytes: Number(rows[0].total), stored_files: rows[0].files }
}
