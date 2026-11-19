// Connected apps (plan Task 7.8): the signed-in user's OAuth grants, and revoking one.
// Revoking sets `revoked_at` on the grant. Access tokens, refresh tokens and codes all check the
// grant's revocation (server/oauth/tokens.js and server/routes/oauth.js), so they stop working at once.
import { query } from '../db.js'
import { HttpError, json } from '../http.js'
import { requirePersonalUser } from '../session.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The host of the app's first registered redirect URI, or null (device logins have none). */
function redirectHost(uris) {
  const first = Array.isArray(uris) ? uris[0] : null
  if (!first) return null
  try {
    return new URL(first).host
  } catch {
    return null
  }
}

function toGrant(row) {
  return {
    id: row.id,
    client_name: row.client_name,
    kind: row.kind,
    redirect_host: redirectHost(row.redirect_uris),
    resource: row.resource,
    scope: row.scope,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    revoked_at: row.revoked_at
  }
}

/** GET /api/grants: the caller's grants, revoked ones included. Never another user's. */
async function listGrants({ request }) {
  const user = await requirePersonalUser(request)
  const { rows } = await query(
    `select g.id, c.client_name, c.kind, c.redirect_uris, g.resource, g.scope,
            g.created_at, g.last_used_at, g.revoked_at
       from oauth_grants g join oauth_clients c on c.client_id = g.client_id
      where g.user_id = $1
      order by g.created_at desc`,
    [user.uid]
  )
  return json({ grants: rows.map(toGrant) })
}

/** DELETE /api/grants/:id: revokes one of the caller's grants. Repeating it is harmless (200). */
async function revokeGrant({ request, params }) {
  const user = await requirePersonalUser(request)
  if (!UUID_RE.test(params.id)) throw new HttpError(404, 'Connected app not found')
  const { rows } = await query(
    `update oauth_grants set revoked_at = coalesce(revoked_at, now())
      where id = $1 and user_id = $2
      returning id`,
    [params.id, user.uid]
  )
  if (rows.length === 0) throw new HttpError(404, 'Connected app not found')
  return json({ ok: true })
}

export const grantRoutes = [
  { method: 'GET', path: '/grants', handler: listGrants },
  { method: 'DELETE', path: '/grants/:id', handler: revokeGrant }
]
