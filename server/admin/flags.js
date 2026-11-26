import { query, transaction } from '../db.js'
import { HttpError, json, readJson } from '../http.js'
import { recordAdminAction } from './audit.js'

// The feature flags of the admin's own account (#483). They are the admin's off switch for the Rare UI look (#406): the first
// value is the default for everyone, and a non-admin never reads these. They change what this admin sees, never what another
// user sees, so a change needs no confirm token. Each change writes one audit row.
const FLAGS = [
  { name: 'look', values: ['rare', 'default'], meaning: 'Colours, corner radius, shadows and motion. rare is the Rare UI look (black, orange) and the default for everyone; default is the old purple look, which only this admin can see.' },
  { name: 'components', values: ['rare', 'default'], meaning: 'rare uses the real Rare UI components (theme choice, Delete draft, character count, toast) and takes the colours of the look; the default for everyone. default uses the old app components, only for this admin.' }
]

const valueOf = (flag, stored) => (flag.values.includes(stored?.[flag.name]) ? stored[flag.name] : flag.values[0])

/** Every flag with its value for this account, its allowed values, its default and its meaning. */
const flagsView = (stored) => FLAGS.map((flag) => ({ name: flag.name, value: valueOf(flag, stored), values: flag.values, default: flag.values[0], meaning: flag.meaning }))

export async function listFlags({ admin }) {
  const { rows } = await query('select ui_flags from users where id = $1', [admin.uid])
  return json({ flags: flagsView(rows[0]?.ui_flags) })
}

export async function setFlag({ admin, request }) {
  const body = await readJson(request)
  const flag = FLAGS.find((f) => f.name === body?.name)
  if (!flag) throw new HttpError(400, `name must be one of: ${FLAGS.map((f) => f.name).join(', ')}.`)
  if (!flag.values.includes(body.value)) throw new HttpError(400, `value of ${flag.name} must be one of: ${flag.values.join(', ')}.`)
  const actor = { uid: admin.uid, gh: admin.gh, login: admin.login, surface: admin.surface }
  const stored = await transaction(async (q) => {
    const { rows } = await q('select ui_flags from users where id = $1 for update', [admin.uid])
    if (!rows[0]) throw new HttpError(404, 'Not found')
    const next = { ...rows[0].ui_flags, [flag.name]: body.value }
    await q('update users set ui_flags = $2::jsonb where id = $1', [admin.uid, JSON.stringify(next)])
    await recordAdminAction(q, { actor, action: 'set_flag', outcome: 'done', details: { flag: flag.name, from: valueOf(flag, rows[0].ui_flags), to: body.value } })
    return next
  })
  return json({ flags: flagsView(stored) })
}
