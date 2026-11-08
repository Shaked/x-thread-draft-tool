import { HttpError, json, readJson } from '../http.js'
import { requireSessionUser, requireUser } from '../session.js'
import { createApiToken, listApiTokens, revokeApiToken } from '../tokens.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** GET /api/tokens: session or bearer. Never includes the token hash. */
async function listTokens({ request }) {
  const user = await requireUser(request)
  return json({ tokens: await listApiTokens(user.uid) })
}

/** POST /api/tokens: browser session only. The plaintext is returned here, once. */
async function createToken({ request }) {
  const user = await requireSessionUser(request)
  const body = await readJson(request, 10_000)
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Body must be a JSON object')
  const created = await createApiToken(user.uid, {
    name: body.name,
    expiresInDays: body.expires_in_days ?? 90,
    via: 'web'
  })
  return json(created, 201)
}

/** DELETE /api/tokens/:id: session or bearer, own tokens only. */
async function revokeToken({ request, params }) {
  const user = await requireUser(request)
  if (!UUID_RE.test(params.id) || !(await revokeApiToken(user.uid, params.id))) {
    throw new HttpError(404, 'Token not found')
  }
  return json({ ok: true })
}

export const tokenRoutes = [
  { method: 'GET', path: '/tokens', handler: listTokens },
  { method: 'POST', path: '/tokens', handler: createToken },
  { method: 'DELETE', path: '/tokens/:id', handler: revokeToken }
]
