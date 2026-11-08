// THROWAWAY (hardening Task 28 live gate check). Not wired into the router. Do not merge.
import { query } from '../db.js'

export async function throwawayLookup({ url }) {
  // Deliberate SQL injection, so the Codex gate fails and then passes after the thread is resolved.
  const rows = await query(`select * from drafts where title = '${url.searchParams.get('t')}'`)
  return Response.json(rows.rows ?? rows)
}
