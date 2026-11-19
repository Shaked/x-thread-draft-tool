import { timingSafeEqual } from 'node:crypto'
import { adminRoute } from '../admin/guard.js'
import { recordAdminAction } from '../admin/audit.js'
import { auditRows, findUserRow, listUserPage, statsRow, userApiTokens, userConnectedApps, userView } from '../admin/queries.js'
import { cleanLogin } from '../admin/clean.js'
import { listBlobPrefix } from '../blob.js'
import { ADMIN_ELEVATION_HOURS, PAIRING_TRIES, pairingHash } from '../admin/pairing.js'
import { query, transaction } from '../db.js'
import { HttpError, json, readJson } from '../http.js'

// Admin routes (plan A2). Each one is built with adminRoute, which refuses everyone but the admin.
const status = async ({ admin }) => {
  const { rows } = await query('select admin_until from oauth_grants where id = $1', [admin.grantId])
  return json({ admin: true, login: admin.login, github_id: admin.gh, admin_until: rows[0]?.admin_until ?? null })
}

/**
 * POST /admin/activate (plan A5): a right pairing code turns admin on for this grant for 24 hours; a wrong one
 * counts as a try, and the third wrong try cancels the code. The grant row is locked, so two calls at once
 * cannot both spend the same try. The code is never stored or logged: only its hash is compared.
 */
const activate = async ({ admin, request }) => {
  const body = await readJson(request)
  if (typeof body?.code !== 'string') throw new HttpError(400, 'Type the pairing code.')
  const code = body.code

  const outcome = await transaction(async (q) => {
    const { rows } = await q(
      `select admin_pending_hash, admin_pending_until > now() as fresh, admin_pending_tries
         from oauth_grants where id = $1 for update`,
      [admin.grantId]
    )
    const grant = rows[0]
    if (!grant || grant.admin_pending_hash === null || !grant.fresh) return { kind: 'none' }

    const given = Buffer.from(pairingHash(admin.grantId, code))
    const stored = Buffer.from(grant.admin_pending_hash)
    if (given.length === stored.length && timingSafeEqual(given, stored)) {
      const { rows: done } = await q(
        `update oauth_grants
            set admin_until = now() + make_interval(hours => $2), admin_pending_hash = null,
                admin_pending_until = null, admin_pending_tries = 0
          where id = $1 returning admin_until`,
        [admin.grantId, ADMIN_ELEVATION_HOURS]
      )
      await recordAdminAction(q, { actor: admin, action: 'elevate_connection', outcome: 'done', details: { hours: ADMIN_ELEVATION_HOURS } })
      return { kind: 'done', admin_until: done[0].admin_until }
    }

    const tries = grant.admin_pending_tries + 1
    const cancelled = tries >= PAIRING_TRIES
    await q(
      `update oauth_grants
          set admin_pending_tries = $2,
              admin_pending_hash = case when $3::boolean then null else admin_pending_hash end,
              admin_pending_until = case when $3::boolean then null else admin_pending_until end
        where id = $1`,
      [admin.grantId, cancelled ? 0 : tries, cancelled]
    )
    await recordAdminAction(q, { actor: admin, action: 'elevate_connection', outcome: 'refused', details: { tries } })
    return { kind: 'wrong', left: PAIRING_TRIES - tries, cancelled }
  })

  // The answer comes after the commit, so a wrong try is kept even though the answer is an error.
  if (outcome.kind === 'none') throw new HttpError(404, 'Not found')
  if (outcome.kind === 'done') return json({ admin: true, admin_until: outcome.admin_until })
  if (outcome.cancelled) return json({ error: 'Wrong code. Start again: connect the app and tick the box.' }, 400)
  return json({ error: `Wrong code. ${outcome.left === 1 ? '1 try' : `${outcome.left} tries`} left.` }, 400)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LOGIN_PREFIX = /^[A-Za-z0-9-]{1,39}$/
const CURSOR_TS = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?([+-])(\d{2})(:\d{2})?$/
const STATUSES = ['all', 'active', 'suspended']

const bad = (message) => new HttpError(400, message)

/** An integer from `1` to `100`, or the default when the parameter is absent. Anything else is 400. */
function pageLimit(url, fallback = 50) {
  if (!url.searchParams.has('limit')) return fallback
  const text = url.searchParams.get('limit')
  if (!/^\d{1,3}$/.test(text) || Number(text) < 1 || Number(text) > 100) throw bad('limit must be 1 to 100.')
  return Number(text)
}

/**
 * True when every field of a cursor time is a real value. Postgres would answer an out-of-range time with a
 * server error, not a 400, so the check is done here (hour 24, minute 61, offset +99 and day 31 of February are refused).
 */
function realTimestamp(m) {
  if (m === null) return false
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number)
  const dayExists = new Date(Date.UTC(year, month - 1, day)).getUTCDate() === day
  const offsetOk = Number(m[9]) <= 15 && (m[10] === undefined || Number(m[10].slice(1)) <= 59)
  return year >= 1 && month >= 1 && month <= 12 && dayExists && hour <= 23 && minute <= 59 && second <= 59 && offsetOk
}

/** The users cursor: base64url of `[created_at text, id]`. Anything else is 400. */
function decodeCursor(text) {
  let parts
  try {
    const raw = Buffer.from(text, 'base64url').toString('utf8')
    if (Buffer.from(raw, 'utf8').toString('base64url') !== text) throw new Error('not canonical')
    parts = JSON.parse(raw)
  } catch {
    throw bad('cursor is not valid.')
  }
  if (!Array.isArray(parts) || parts.length !== 2 || typeof parts[0] !== 'string' || typeof parts[1] !== 'string') throw bad('cursor is not valid.')
  const [ts, id] = parts
  if (!realTimestamp(CURSOR_TS.exec(ts)) || !UUID.test(id)) throw bad('cursor is not valid.')
  return { afterTs: ts, afterId: id }
}

const encodeCursor = (row) => Buffer.from(JSON.stringify([row.cursor_ts, row.id])).toString('base64url')

const listUsers = async ({ url }) => {
  const limit = pageLimit(url)
  const q = url.searchParams.get('q')
  if (q !== null && !LOGIN_PREFIX.test(q)) throw bad('q must be 1 to 39 letters, digits or hyphens.')
  const status = url.searchParams.get('status') ?? 'all'
  if (!STATUSES.includes(status)) throw bad('status must be all, active or suspended.')
  const cursor = url.searchParams.get('cursor')
  const after = cursor === null ? {} : decodeCursor(cursor)
  const rows = await listUserPage({ limit, q, status, ...after })
  const page = rows.slice(0, limit)
  const next_cursor = rows.length > limit ? encodeCursor(page.at(-1)) : null
  return json({ users: page.map(userView), next_cursor })
}

const getUser = async ({ params }) => {
  if (!UUID.test(params.id)) throw new HttpError(404, 'User not found')
  const row = await findUserRow(params.id)
  if (!row) throw new HttpError(404, 'User not found')
  const [tokens, apps] = await Promise.all([userApiTokens(row.id), userConnectedApps(row.id)])
  // The image listing is a Blob call, not SQL. A failed listing leaves both counts null, not an error.
  let images = { image_files: null, image_bytes: null, image_files_truncated: null }
  try {
    const listing = await listBlobPrefix(`drafts/${row.id}/`)
    images = {
      image_files: listing.files.length,
      image_bytes: listing.files.reduce((sum, file) => sum + Number(file.size ?? 0), 0),
      image_files_truncated: listing.truncated === true
    }
  } catch (err) {
    console.error('[admin] image listing failed', err)
  }
  return json({
    user: {
      ...userView(row),
      ...images,
      api_tokens: tokens,
      connected_apps: apps.map((app) => ({
        id: app.id,
        kind: app.kind,
        redirect_host: hostOf(app.redirect_uris?.[0]),
        resource: app.resource,
        created_at: app.created_at,
        last_used_at: app.last_used_at,
        revoked_at: app.revoked_at,
        admin: app.admin === true
      }))
    }
  })
}

/** The host of a return address, or null. Only the host leaves the server: never the path or query. */
function hostOf(uri) {
  try {
    return new URL(uri).host
  } catch {
    return null
  }
}

const stats = async () => json({ stats: await statsRow() })

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/
const audit = async ({ url }) => {
  const limit = pageLimit(url)
  const before = url.searchParams.get('before')
  if (before !== null && (!ISO_TIME.test(before) || Number.isNaN(Date.parse(before)))) throw bad('before must be an ISO time.')
  const rows = await auditRows({ limit, before })
  return json({
    events: rows.map((row) => ({
      id: row.id,
      created_at: row.created_at,
      actor_login: cleanLogin(row.actor_login),
      action: row.action,
      outcome: row.outcome,
      target_github_id: row.target_github_id === null ? null : String(row.target_github_id),
      target_login: row.target_login === null ? null : cleanLogin(row.target_login),
      details: row.details
    }))
  })
}

export const adminRoutes = [
  adminRoute('GET', '/admin/status', status),
  adminRoute('POST', '/admin/activate', activate, { pending: true }),
  adminRoute('GET', '/admin/users', listUsers),
  adminRoute('GET', '/admin/users/:id', getUser),
  adminRoute('GET', '/admin/stats', stats),
  adminRoute('GET', '/admin/audit', audit)
]
