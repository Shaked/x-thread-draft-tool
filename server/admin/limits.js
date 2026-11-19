// Admin action limits (plan A8, decision D22). Counts this admin's recorded actions of the given kinds in the
// last hour. Suspend counts `done` and `started` rows; delete counts `started` rows only, so a delete that failed
// plus its retry uses 2 of the 5 and a finished delete uses 1.
export const ADMIN_LIMITS = Object.freeze({
  suspend: { actions: ['suspend_user', 'unsuspend_user'], perHour: 30 },
  delete: { actions: ['delete_user'], perHour: 5, outcomes: ['started'] }
})

/**
 * True while the admin has done fewer than `perHour` of `actions` in the last hour. `run` is `query` or a
 * transaction's `q`. The caller holds the admin's user row lock, so two calls at once cannot both pass.
 */
export async function withinAdminLimit(run, adminUid, actions, perHour, outcomes = ['done', 'started']) {
  const { rows } = await run(
    `select count(*)::int as n from admin_audit
      where actor_user_id = $1 and action = any($2::text[]) and outcome = any($3::text[])
        and created_at > now() - interval '1 hour'`,
    [adminUid, actions, outcomes]
  )
  return rows[0].n < perHour
}
