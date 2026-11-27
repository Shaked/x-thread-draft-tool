// The admin audit log. One row per admin event; no foreign keys, so a row outlives the user it names.
const OUTCOMES = ['done', 'started', 'refused', 'failed']
const SURFACES = ['mcp', 'web']

/**
 * Writes one audit row. `run` is `query` or a transaction's `q`. `actor` is `{ uid, gh, login }`,
 * `target` is null or `{ id, github_id, login }`. `details` must never hold a secret. Returns the new row's id.
 */
export async function recordAdminAction(run, { actor, action, outcome, target = null, details = {} }) {
  if (!OUTCOMES.includes(outcome)) throw new Error(`unknown audit outcome: ${outcome}`)
  // Every row says which surface acted (#284): the MCP connection or the owner's browser session.
  if (!SURFACES.includes(actor.surface)) throw new Error(`unknown audit surface: ${actor.surface}`)
  const { rows } = await run(
    `insert into admin_audit
       (actor_user_id, actor_github_id, actor_login, action, outcome, target_user_id, target_github_id, target_login, details)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     returning id`,
    [
      actor.uid,
      actor.gh,
      actor.login,
      action,
      outcome,
      target?.id ?? null,
      target?.github_id ?? null,
      target?.login ?? null,
      JSON.stringify({ ...details, surface: actor.surface })
    ]
  )
  return rows[0].id
}
