// Delete a user and all their content (plan A9, issue #199). Files first, then one transaction, so no state
// leaves files without a way to remove them: a failed file step leaves the user suspended with every row,
// and a retry removes the rest.
import { HttpError, json } from '../http.js'
import { query, transaction } from '../db.js'
import { listBlobPrefix, removeBlobPrefix } from '../blob.js'
import { recordAdminAction } from './audit.js'
import { bindOf, sealAdminConfirm, openAdminConfirm } from './confirm.js'
import { isProtectedGithubId, protectedGithubIds } from './identity.js'
import { ADMIN_LIMITS, withinAdminLimit } from './limits.js'

const DELETE_WAIT_MINUTES = 10
const CONFIRM_SECONDS = 600

// The rows the cascade removes, counted in one statement. oauth_codes and api_token_cap_backup are not shown:
// they are short-lived copies, and tests/api/admin-schema.test.js pins the whole list.
const COUNTS_SQL = `select
    (select count(*)::int from drafts where user_id = $1) as drafts,
    (select count(*)::int from share_tokens where created_by = $1) as share_links,
    (select count(*)::int from api_tokens where user_id = $1) as api_tokens,
    (select count(*)::int from oauth_grants where user_id = $1) as connected_apps,
    (select count(*)::int from oauth_tokens t join oauth_grants g on g.id = t.grant_id where g.user_id = $1) as oauth_tokens,
    (select count(*)::int from mcp_rate_limits where user_id = $1) as mcp_rate_rows`

// The SQL repeats the protection on purpose: a protected or unsuspended user never matches.
export const DELETE_SQL = `delete from users where id = $1 and suspended_at is not null and github_id <> all($2::bigint[]) returning id`

const bad = (message) => new HttpError(400, message)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

async function currentCounts(id) {
  const { rows } = await query(COUNTS_SQL, [id])
  const listing = await listBlobPrefix(`drafts/${id}/`)
  // A listing holds 1000 files at most: say so, so the preview is never taken for the whole count.
  return { ...rows[0], image_files: listing.files.length, ...(listing.truncated ? { image_files_truncated: true } : {}) }
}

/** The checks of both modes, in order. Returns the user row or throws. */
async function checkTarget(actor, id) {
  const { rows } = await query(
    `select id, github_id, login, suspended_at, suspended_at + make_interval(mins => $2) as ready_at,
            (suspended_at is not null and now() >= suspended_at + make_interval(mins => $2)) as waited
       from users where id = $1`,
    [id, DELETE_WAIT_MINUTES]
  )
  const user = rows[0]
  if (!user) throw new HttpError(404, 'User not found')
  const target = { id: user.id, github_id: user.github_id, login: user.login }
  if (isProtectedGithubId(user.github_id)) {
    await recordAdminAction(query, { actor, action: 'delete_user', outcome: 'refused', target })
    throw new HttpError(403, 'This account cannot be suspended or deleted.')
  }
  if (user.suspended_at === null) throw new HttpError(409, 'Suspend the user first (admin_suspend_user, or Suspend on the admin page).')
  if (!user.waited) {
    throw new HttpError(409, `Wait until ${new Date(user.ready_at).toISOString()}: a user must be suspended for ${DELETE_WAIT_MINUTES} minutes before deletion.`)
  }
  return { user, target }
}

/** Fails the files step: the audit row, then 502. The database is untouched. */
async function filesFailed(actor, target, progress, remaining) {
  try {
    await recordAdminAction(query, { actor, action: 'delete_user', outcome: 'failed', target, details: { stage: 'files', deleted: progress.deleted, remaining } })
  } catch (error) {
    console.error('[admin] audit write failed', error)
  }
  return new HttpError(502, 'Some image files could not be deleted. Nothing else was removed. Run the dry run and the delete again.')
}

/** The transaction did not delete: record why and answer. The files are already gone, so the audit row matters. */
async function refuseAfterFiles(actor, target, outcome) {
  await recordAdminAction(query, { actor, action: 'delete_user', outcome: 'failed', target, details: { stage: 'db', reason: outcome } })
  throw outcome === 'gone' ? new HttpError(404, 'User not found') : new HttpError(409, 'The user changed. Run the dry run again.')
}

/**
 * True when the token was made for this delete, by this admin, on this surface, for this binding (the MCP grant, or the
 * browser session's jti). A token from the other surface or another session is refused (#284).
 */
function tokenOpens(sealed, admin, id) {
  return Boolean(sealed) && sealed.act === 'delete_user' && sealed.target === id && sealed.admin === admin.uid
    && sealed.surface === admin.surface && typeof sealed.bind === 'string' && sealed.bind.length > 0 && sealed.bind === bindOf(admin)
}

export async function deleteUser(admin, id, body) {
  const actor = { uid: admin.uid, gh: admin.gh, login: admin.login, surface: admin.surface }
  const { user, target } = await checkTarget(actor, id)
  const dryRun = body?.dry_run !== false

  let counts
  try {
    counts = await currentCounts(id)
  } catch (error) {
    console.error('[admin] image listing failed', error)
    throw new HttpError(502, 'The image files could not be listed. Try again.')
  }

  if (dryRun) {
    const confirm_token = await sealAdminConfirm({ act: 'delete_user', target: id, gh: String(user.github_id), login: user.login, counts, admin: admin.uid, surface: admin.surface, bind: bindOf(admin) })
    return json({ dry_run: true, user: target, will_delete: counts, confirm_token, expires_in: CONFIRM_SECONDS })
  }

  const sealed = await openAdminConfirm(body.confirm_token)
  if (!tokenOpens(sealed, admin, id)) {
    throw bad('confirm_token is not valid for this call. Run the dry run again.')
  }
  if (typeof body.confirm_login !== 'string' || body.confirm_login !== sealed.login || body.confirm_login !== user.login) {
    throw bad("confirm_login does not match this user's login")
  }
  if (!same(sealed.counts, counts)) throw new HttpError(409, 'The content changed. Run the dry run again.')

  // The limit counts `started` rows. The admin's row is locked, so two runs at once cannot both exceed the limit.
  const begun = await transaction(async (q) => {
    await q('select id from users where id = $1 for update', [admin.uid])
    // The target is locked here and unsuspend checks for this `started` row under the same lock, so the
    // user cannot be restored once the files start to go.
    const { rows: still } = await q('select suspended_at from users where id = $1 for update', [id])
    if (still.length === 0) return 'gone'
    if (still[0].suspended_at === null) throw new HttpError(409, 'Suspend the user first (admin_suspend_user, or Suspend on the admin page).')
    if (!(await withinAdminLimit(q, admin.uid, ADMIN_LIMITS.delete.actions, ADMIN_LIMITS.delete.perHour, ADMIN_LIMITS.delete.outcomes))) {
      throw new HttpError(429, `Admin limit reached: at most ${ADMIN_LIMITS.delete.perHour} of these actions per hour.`)
    }
    await recordAdminAction(q, { actor, action: 'delete_user', outcome: 'started', target, details: { counts } })
    return 'started'
  })
  if (begun === 'gone') {
    await recordAdminAction(query, { actor, action: 'delete_user', outcome: 'failed', target, details: { stage: 'db', reason: 'gone' } })
    throw new HttpError(404, 'User not found')
  }

  let files
  try {
    files = await removeBlobPrefix(`drafts/${id}/`)
  } catch (error) {
    console.error('[admin] image delete failed', error)
    throw await filesFailed(actor, target, error.progress ?? { deleted: 0 }, null)
  }
  if (files.remaining > 0) throw await filesFailed(actor, target, files, files.remaining)

  let outcome
  try {
    outcome = await transaction(async (q) => {
      const { rows } = await q('select id, github_id, suspended_at from users where id = $1 for update', [id])
      if (rows.length === 0) return 'gone'
      if (isProtectedGithubId(rows[0].github_id)) return 'protected'
      if (rows[0].suspended_at === null) return 'unsuspended'
      const { rows: removed } = await q(DELETE_SQL, [id, protectedGithubIds()])
      if (removed.length === 0) return 'unchanged'
      await recordAdminAction(q, { actor, action: 'delete_user', outcome: 'done', target, details: { counts, files_deleted: files.deleted, bytes_deleted: files.bytes } })
      return 'done'
    })
  } catch (error) {
    console.error('[admin] delete transaction failed', error)
    try {
      await recordAdminAction(query, { actor, action: 'delete_user', outcome: 'failed', target, details: { stage: 'db', reason: 'error' } })
    } catch (auditError) {
      console.error('[admin] audit write failed', auditError)
    }
    throw new HttpError(500, 'The user could not be deleted. Nothing was changed in the database. Run the dry run and the delete again.')
  }

  if (outcome !== 'done') await refuseAfterFiles(actor, target, outcome)
  return json({ deleted: true, user: target, removed: counts, files_deleted: files.deleted, bytes_deleted: files.bytes })
}
