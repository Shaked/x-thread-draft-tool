import { HttpError, json, readJson } from '../http.js'
import { requirePersonalUser, requireSessionUser } from '../session.js'
import { createApiToken, listApiTokens, MAX_EXPIRY_DAYS, revokeApiToken } from '../tokens.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** GET /api/tokens: browser session or personal xt_ token; OAuth access tokens get 403. Never includes the token hash. */
async function listTokens({ request }) {
  const user = await requirePersonalUser(request)
  return json({ tokens: await listApiTokens(user.uid) })
}

/** POST /api/tokens: browser session only. The plaintext is returned here, once. */
async function createToken({ request }) {
  const user = await requireSessionUser(request)
  const body = await readJson(request, 10_000)
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Body must be a JSON object')
  const created = await createApiToken(user.uid, {
    name: body.name,
    expiresInDays: body.expires_in_days ?? MAX_EXPIRY_DAYS,
    via: 'web'
  })
  return json(created, 201)
}

/** DELETE /api/tokens/:id: browser session or personal xt_ token, own tokens only; OAuth gets 403. */
async function revokeToken({ request, params }) {
  const user = await requirePersonalUser(request)
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
