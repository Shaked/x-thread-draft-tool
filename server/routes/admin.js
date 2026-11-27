import { adminRoute } from '../admin/guard.js'
import { recordAdminAction } from '../admin/audit.js'
import { SUSPEND_SQL, UNSUSPEND_SQL, auditRows, findUserRow, listUserPage, statsRow, userApiTokens, userConnectedApps, userView } from '../admin/queries.js'
import { cleanLogin, cleanName } from '../admin/clean.js'
import { ADMIN_LIMITS, withinAdminLimit } from '../admin/limits.js'
import { isProtectedGithubId, protectedGithubIds } from '../admin/identity.js'
import { listBlobPrefix } from '../blob.js'
import { deleteUser } from '../admin/delete-user.js'
import { query, transaction } from '../db.js'
import { VIEW_AS_SECONDS, clearViewAsCookie, openViewAs, sealViewAs, viewAsCookie, viewAsCookieValue } from '../admin/view-as.js'
import { HttpError, json, readJson, readOptionalJson } from '../http.js'
import { listFlags, setFlag } from '../admin/flags.js'
import { eventsParams, eventsView, summaryParams, summaryView } from '../metrics/summary.js'
import { cached, metricsParams, metricsView, seriesParams, seriesView } from '../metrics/view.js'

// Admin routes (plan A2). Each one is built with adminRoute, which refuses everyone but the admin.
const status = async ({ admin }) => json({ admin: true, login: admin.login, github_id: admin.gh })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LOGIN_PREFIX = /^[A-Za-z0-9-]{1,39}$/
// An ISO-like time with a space or T between date and time, and Z or an offset (Postgres text form too).
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:(Z)|([+-])(\d{2})(?::?(\d{2}))?)$/i
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
 * True when every field of a timestamp is a real value. Postgres would answer an out-of-range time with a
 * server error, not a 400, so the check is done here (February 31, hour 24, minute 61, offset +20:00 are refused).
 */
function realTimestamp(text) {
  const m = TIMESTAMP.exec(text)
  if (m === null) return false
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number)
  const dayExists = new Date(Date.UTC(year, month - 1, day)).getUTCDate() === day
  const offsetOk = Number(m[9] ?? 0) <= 15 && Number(m[10] ?? 0) <= 59
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
  if (!realTimestamp(ts) || !UUID.test(id)) throw bad('cursor is not valid.')
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

/** One connected app as the admin sees it: the kind, the host of its return address and the resource, never the name. */
const appView = (app) => ({
  id: app.id,
  kind: app.kind,
  redirect_host: hostOf(app.redirect_uris?.[0]),
  resource: app.resource,
  created_at: app.created_at,
  last_used_at: app.last_used_at,
  revoked_at: app.revoked_at
})

/** One user with counts, tokens and connected apps (no Blob numbers), or null. Used by the reads and by suspend. */
async function userDetail(id) {
  const row = await findUserRow(id)
  if (!row) return null
  const [tokens, apps] = await Promise.all([userApiTokens(row.id), userConnectedApps(row.id)])
  return { row, user: { ...userView(row), api_tokens: tokens, connected_apps: apps.map(appView) } }
}

const getUser = async ({ params }) => {
  if (!UUID.test(params.id)) throw new HttpError(404, 'User not found')
  const found = await userDetail(params.id)
  if (!found) throw new HttpError(404, 'User not found')
  // The image listing is a Blob call, not SQL. A failed listing leaves both counts null, not an error.
  let images = { image_files: null, image_bytes: null, image_files_truncated: null }
  try {
    const listing = await listBlobPrefix(`drafts/${found.row.id}/`)
    images = {
      image_files: listing.files.length,
      image_bytes: listing.files.reduce((sum, file) => sum + Number(file.size ?? 0), 0),
      image_files_truncated: listing.truncated === true
    }
  } catch (err) {
    console.error('[admin] image listing failed', err)
  }
  return json({ user: { ...found.user, ...images } })
}

/** The host of a return address, or null. Only the host leaves the server: never the path or query. */
function hostOf(uri) {
  try {
    return new URL(uri).host
  } catch {
    return null
  }
}

/**
 * Suspends or unsuspends one user (plan A8). One transaction: the admin's row is locked and the limit checked,
 * the user row is locked, the checks run, the change and its audit row are written. The answers that refuse
 * (404, 400, 403) are returned after the commit, so their audit row (`refused`) is kept.
 */
async function changeSuspension(admin, id, body, suspend) {
  if (typeof body?.confirm_login !== 'string') throw bad('Type confirm_login: the login of this user, exactly.')
  const reason = suspend ? suspendReason(body.reason) : null
  const action = suspend ? 'suspend_user' : 'unsuspend_user'
  const actor = { uid: admin.uid, gh: admin.gh, login: admin.login, surface: admin.surface }
  const outcome = await transaction(async (q) => {
    await q('select id from users where id = $1 for update', [admin.uid])
    if (!(await withinAdminLimit(q, admin.uid, ADMIN_LIMITS.suspend.actions, ADMIN_LIMITS.suspend.perHour))) {
      throw new HttpError(429, `Admin limit reached: at most ${ADMIN_LIMITS.suspend.perHour} of these actions per hour.`)
    }
    const { rows } = await q('select id, github_id, login from users where id = $1 for update', [id])
    const target = rows[0]
    if (!target) return { kind: 'missing' }
    if (target.login !== body.confirm_login) return { kind: 'mismatch' }
    const targetAudit = { id: target.id, github_id: target.github_id, login: target.login }
    if (!suspend) {
      // A delete of this user that started in the last 15 minutes and has no `failed` or `done` row yet.
      const { rows: running } = await q(
        `select 1 from admin_audit s where s.action = 'delete_user' and s.outcome = 'started' and s.target_user_id = $1
            and s.created_at > now() - interval '15 minutes'
            and not exists (select 1 from admin_audit f where f.action = 'delete_user' and f.target_user_id = $1
                              and f.outcome in ('failed', 'done') and f.created_at >= s.created_at) limit 1`,
        [target.id]
      )
      if (running.length > 0) return { kind: 'deleting' }
    }
    if (isProtectedGithubId(target.github_id)) {
      await recordAdminAction(q, { actor, action, outcome: 'refused', target: targetAudit })
      return { kind: 'refused' }
    }
    const protectedIds = protectedGithubIds()
    const { rows: changed } = await q(suspend ? SUSPEND_SQL : UNSUSPEND_SQL, suspend ? [target.id, reason, protectedIds] : [target.id, protectedIds])
    if (changed.length === 0) return { kind: 'unchanged' }
    if (suspend) {
      // What stops working at once: the active tokens, connected apps and share links of this user.
      const { rows: counts } = await q(
        `select (select count(*)::int from api_tokens where user_id = $1 and revoked_at is null and (expires_at is null or expires_at > now())) as api_tokens,
                (select count(*)::int from oauth_grants where user_id = $1 and revoked_at is null) as connected_apps,
                (select count(*)::int from share_tokens where created_by = $1
                   and coalesce(expires_at, created_at + interval '1 hour') > now() and (one_time = false or used = false)) as share_links`,
        [target.id]
      )
      await recordAdminAction(q, { actor, action, outcome: 'done', target: targetAudit, details: { reason, counts: counts[0] } })
    } else {
      await recordAdminAction(q, { actor, action, outcome: 'done', target: targetAudit })
    }
    return { kind: 'changed' }
  })

  if (outcome.kind === 'missing') throw new HttpError(404, 'User not found')
  if (outcome.kind === 'mismatch') throw bad("confirm_login does not match this user's login")
  if (outcome.kind === 'deleting') throw new HttpError(409, 'A deletion of this user is running. Try again in a few minutes.')
  if (outcome.kind === 'refused') throw new HttpError(403, 'This account cannot be suspended or deleted.')
  const found = await userDetail(id)
  if (!found) throw new HttpError(404, 'User not found')
  return json({ user: found.user, changed: outcome.kind === 'changed' })
}

/** The optional reason: text of at most 200 characters, cleaned like a name. Empty becomes null. */
function suspendReason(value) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw bad('reason must be text.')
  if (Array.from(value).length > 200) throw bad('reason must be at most 200 characters.')
  return cleanName(value, 200) || null
}

const suspendUser = async ({ admin, request, params }) => {
  if (!UUID.test(params.id)) throw new HttpError(404, 'User not found')
  return changeSuspension(admin, params.id, await readJson(request), true)
}
const unsuspendUser = async ({ admin, request, params }) => {
  if (!UUID.test(params.id)) throw new HttpError(404, 'User not found')
  return changeSuspension(admin, params.id, await readJson(request), false)
}

const deleteUserRoute = async ({ admin, request, params }) => {
  if (!UUID.test(params.id)) throw new HttpError(404, 'User not found')
  return deleteUser(admin, params.id.toLowerCase(), await readOptionalJson(request))
}

/** The required reason of a view-as start: 3 to 200 characters once cleaned. */
function viewAsReason(value) {
  if (typeof value !== 'string') throw bad('reason is required: 3 to 200 characters.')
  const reason = cleanName(value, 200).trim()
  if (Array.from(reason).length < 3 || Array.from(value).length > 200) throw bad('reason is required: 3 to 200 characters.')
  return reason
}

/** A Response with the JSON body and Set-Cookie headers. */
function withCookies(body, cookies) {
  const headers = new Headers([['content-type', 'application/json'], ['cache-control', 'no-store']])
  for (const value of cookies) headers.append('set-cookie', value)
  return new Response(JSON.stringify(body), { status: 200, headers })
}

/**
 * Starts viewing as a user (#290). Web surface only. One transaction, like a suspension: the admin's row is locked, the
 * limit checked, the target checked, and the audit row written (`view_as_start` done, or `refused`). The refusals are
 * returned after the commit so their row is kept. The claim's `vid` is the start row's id.
 */
const startViewAs = async ({ admin, request }) => {
  if (admin.surface === 'mcp') throw new HttpError(403, 'View as is for the website only.')
  const body = await readJson(request)
  const userId = typeof body?.user_id === 'string' ? body.user_id : ''
  if (!UUID.test(userId)) throw bad('user_id must be a user id (a UUID).')
  const reason = viewAsReason(body.reason)
  const actor = { uid: admin.uid, gh: admin.gh, login: admin.login, surface: admin.surface }
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = new Date((now + VIEW_AS_SECONDS) * 1000).toISOString()
  const outcome = await transaction(async (q) => {
    await q('select id from users where id = $1 for update', [admin.uid])
    if (!(await withinAdminLimit(q, admin.uid, ADMIN_LIMITS.viewAs.actions, ADMIN_LIMITS.viewAs.perHour))) {
      throw new HttpError(429, `Admin limit reached: at most ${ADMIN_LIMITS.viewAs.perHour} of these actions per hour.`)
    }
    const { rows } = await q('select id, github_id, login, suspended_at from users where id = $1', [userId.toLowerCase()])
    const target = rows[0]
    const refuse = async (why, status, message, audited) => {
      await recordAdminAction(q, { actor, action: 'view_as_start', outcome: 'refused', target: audited, details: { reason, why, user_id: userId.toLowerCase() } })
      return { kind: 'refused', error: new HttpError(status, message) }
    }
    if (!target) return refuse('missing', 404, 'User not found', null)
    const audited = { id: target.id, github_id: target.github_id, login: target.login }
    if (isProtectedGithubId(target.github_id)) return refuse('protected', 403, 'This account cannot be viewed as.', audited)
    if (target.suspended_at !== null) return refuse('suspended', 409, 'This user is suspended and cannot be viewed as.', audited)
    const vid = await recordAdminAction(q, { actor, action: 'view_as_start', outcome: 'done', target: audited, details: { reason, expires_at: expiresAt } })
    return { kind: 'started', vid, target }
  })
  if (outcome.kind === 'refused') throw outcome.error
  const { target, vid } = outcome
  const token = await sealViewAs(
    { adminUid: admin.uid, adminJti: admin.jti, targetUid: target.id, targetGh: target.github_id, targetLogin: target.login, reason, vid },
    now
  )
  return withCookies({ view_as: { user_id: target.id, login: target.login, expires_at: expiresAt } }, [viewAsCookie(token)])
}

/**
 * Ends viewing (#290): clears the cookie and, when the cookie holds this admin's live claim, writes `view_as_end`. That row
 * kills the claim at once (server/session.js), so a copy of the old cookie value no longer works. An expiry writes no row.
 * With no live claim the cookie is cleared and nothing is written.
 */
const endViewAs = async ({ admin, request }) => {
  if (admin.surface === 'mcp') throw new HttpError(403, 'View as is for the website only.')
  const claim = await openViewAs(viewAsCookieValue(request))
  let ended = false
  if (claim !== null && claim.admin_uid === admin.uid && claim.admin_jti === admin.jti && typeof claim.vid === 'string') {
    const actor = { uid: admin.uid, gh: admin.gh, login: admin.login, surface: admin.surface }
    const { rows } = await query('select github_id, login from users where id = $1', [claim.target_uid])
    const target = rows[0] ? { id: claim.target_uid, github_id: rows[0].github_id, login: rows[0].login } : null
    await recordAdminAction(query, { actor, action: 'view_as_end', outcome: 'done', target, details: { vid: claim.vid } })
    ended = true
  }
  return withCookies({ ok: true, ended }, [clearViewAsCookie()])
}

const stats = async () => json({ stats: await statsRow() })

const audit = async ({ url }) => {
  const limit = pageLimit(url)
  const before = url.searchParams.get('before')
  if (before !== null && !realTimestamp(before)) throw bad('before must be an ISO time.')
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

// The route keys ("METHOD /path") of server/router.js. Read per request: router.js imports this file, so a static import would cycle.
async function routeKeys() {
  const { ROUTES } = await import('../router.js')
  return new Set(ROUTES.map((route) => `${route.method} ${route.path}`))
}

// Observability plan O4 (#335): the metrics views (server/metrics/view.js), cached for 60 s per parameter set.
const metrics = async ({ url }) => {
  const params = metricsParams(url.searchParams, await routeKeys())
  return json(await cached(`metrics ${JSON.stringify(params)}`, () => metricsView(params)))
}

const metricsSeries = async ({ url }) => {
  const params = seriesParams(url.searchParams, await routeKeys())
  return json(await cached(`series ${JSON.stringify(params)}`, () => seriesView(params)))
}

// Central metrics M5 (#451): the summary in plain lines (cached 60 s like the other views) and the events list.
const metricsSummary = async ({ url }) => {
  const params = summaryParams(url.searchParams)
  return json(await cached(`summary ${JSON.stringify(params)}`, () => summaryView(params)))
}

const metricsEvents = async ({ url }) => json(await eventsView(eventsParams(url.searchParams)))

export const adminRoutes = [
  adminRoute('GET', '/admin/status', status),
  adminRoute('GET', '/admin/users', listUsers),
  adminRoute('GET', '/admin/users/:id', getUser),
  adminRoute('POST', '/admin/users/:id/suspend', suspendUser),
  adminRoute('POST', '/admin/users/:id/unsuspend', unsuspendUser),
  adminRoute('POST', '/admin/users/:id/delete', deleteUserRoute),
  adminRoute('GET', '/admin/stats', stats),
  adminRoute('GET', '/admin/audit', audit),
  adminRoute('GET', '/admin/metrics', metrics),
  adminRoute('GET', '/admin/metrics/series', metricsSeries),
  adminRoute('GET', '/admin/metrics/summary', metricsSummary),
  adminRoute('GET', '/admin/metrics/events', metricsEvents),
  adminRoute('GET', '/admin/flags', listFlags),
  adminRoute('POST', '/admin/flags', setFlag),
  adminRoute('POST', '/admin/view-as', startViewAs),
  adminRoute('DELETE', '/admin/view-as', endViewAs)
]
