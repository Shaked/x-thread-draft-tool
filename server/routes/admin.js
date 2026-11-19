import { timingSafeEqual } from 'node:crypto'
import { adminRoute } from '../admin/guard.js'
import { recordAdminAction } from '../admin/audit.js'
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

export const adminRoutes = [
  adminRoute('GET', '/admin/status', status),
  adminRoute('POST', '/admin/activate', activate, { pending: true })
]
