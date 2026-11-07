import { HttpError, json, readJson } from '../http.js'
import { splitIntoThreads } from '../../src/utils/threadSplitter.js'

const MAX_BODY_BYTES = 100 * 1024

/** POST /api/threads/split { text, max_chars? } (no auth): same splitter as the editor. */
export async function splitThread({ request }) {
  const body = await readJson(request, MAX_BODY_BYTES)
  if (!body || typeof body !== 'object' || typeof body.text !== 'string') {
    throw new HttpError(400, 'text must be a string')
  }
  const maxChars = body.max_chars ?? 280
  if (!Number.isInteger(maxChars) || maxChars < 20 || maxChars > 1000) {
    throw new HttpError(400, 'max_chars must be an integer from 20 to 1000')
  }
  const posts = splitIntoThreads(body.text, maxChars).map((text) => ({ text, chars: text.length }))
  return json({ posts })
}

export const threadRoutes = [{ method: 'POST', path: '/threads/split', handler: splitThread, ci: true }]
