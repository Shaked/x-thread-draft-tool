// GET /api/changelog (docs/plans/settings-menu.md M14). The build writes server/generated/changelog.js
// from docs/changelogs (scripts/build-info.mjs, M13). Signed in only (owner question Q3, default).
import { HttpError, json } from './http.js'
import { requireUser } from './session.js'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

const loadGenerated = () => import('./generated/changelog.js').then((mod) => mod.default).catch(() => [])

/** One page of entries (newest first). `before` is an id from an earlier page's `next`. */
function pageOf(entries, { limit, before }) {
  let start = 0
  if (before !== null) {
    const index = entries.findIndex((entry) => entry.id === before)
    if (index === -1) throw new HttpError(400, 'before is not a known changelog entry')
    start = index + 1
  }
  const page = entries.slice(start, start + limit)
  const more = start + limit < entries.length
  return { entries: page, next: more ? page.at(-1).id : null }
}

function limitOf(url) {
  const raw = url.searchParams.get('limit')
  if (raw === null) return DEFAULT_LIMIT
  const n = Number(raw)
  if (!/^\d+$/.test(raw) || n < 1 || n > MAX_LIMIT) throw new HttpError(400, `limit must be a whole number from 1 to ${MAX_LIMIT}`)
  return n
}

async function changelogHandler({ request, url }) {
  await requireUser(request)
  const page = pageOf(await loadGenerated(), { limit: limitOf(url), before: url.searchParams.get('before') })
  return json(page, 200, { 'cache-control': 'private, max-age=300' })
}

export const changelogRoutes = [{ method: 'GET', path: '/changelog', handler: changelogHandler }]
