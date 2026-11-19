// Admin action limits (plan A8, decision D22). Counts this admin's recorded actions of the given kinds in the
// last hour. A `done` or a `started` row counts, so a delete that failed plus its retry uses 2 of the 5.
export const ADMIN_LIMITS = Object.freeze({
  suspend: { actions: ['suspend_user', 'unsuspend_user'], perHour: 30 },
  delete: { actions: ['delete_user'], perHour: 5 }
})

/**
 * True while the admin has done fewer than `perHour` of `actions` in the last hour. `run` is `query` or a
 * transaction's `q`. The caller holds the admin's user row lock, so two calls at once cannot both pass.
 */
export async function withinAdminLimit(run, adminUid, actions, perHour) {
  const { rows } = await run(
    `select count(*)::int as n from admin_audit
      where actor_user_id = $1 and action = any($2::text[]) and outcome in ('done', 'started')
        and created_at > now() - interval '1 hour'`,
    [adminUid, actions]
  )
  return rows[0].n < perHour
}
