import { adminRoute } from '../admin/guard.js'
import { query } from '../db.js'
import { json } from '../http.js'

// Admin routes (plan A2). Each one is built with adminRoute, which refuses everyone but the admin.
const status = async ({ admin }) => {
  const { rows } = await query('select admin_until from oauth_grants where id = $1', [admin.grantId])
  return json({ admin: true, login: admin.login, github_id: admin.gh, admin_until: rows[0]?.admin_until ?? null })
}

export const adminRoutes = [adminRoute('GET', '/admin/status', status)]
