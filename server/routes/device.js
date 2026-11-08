import { HttpError, json, readJson } from '../http.js'
import { fetchGithubUser, upsertGithubUser } from '../github-user.js'
import { apiResource } from '../session.js'
import { transaction } from '../db.js'
import { SCOPE, issuePair } from '../oauth/tokens.js'

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'
const JSON_HEADERS = { accept: 'application/json', 'content-type': 'application/json' }
const DEFAULT_NAME = 'Device token'
const MAX_NAME = 100

/**
 * POST /api/auth/device/start (no auth). Starts GitHub's device flow for an agent.
 * The agent shows the user `user_code` and `verification_uri`, then polls /poll.
 * Needs "Enable Device Flow" on the GitHub OAuth App; no client secret is used.
 */
export async function startDevice() {
  const response = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, scope: 'read:user' })
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.device_code) throw new HttpError(502, 'GitHub device sign-in is unavailable')
  return json({
    device_code: data.device_code,
    user_code: data.user_code,
    verification_uri: data.verification_uri,
    interval: data.interval ?? 5,
    expires_in: data.expires_in
  })
}

/** The connected-app name for a device login: trimmed, non-empty, at most 100 characters. */
function deviceName(value) {
  if (typeof value !== 'string' || !value.trim()) return DEFAULT_NAME
  const name = value.trim()
  if (name.length > MAX_NAME) throw new HttpError(400, `name must be at most ${MAX_NAME} characters`)
  return name
}

/**
 * Finds or creates the device's grant (one per user, device name and resource) and returns its id.
 * A revoked grant is replaced, never reactivated, so tokens issued before the revocation stay dead.
 */
async function deviceGrant(userId, name, resource) {
  const clientId = `device:${name}`
  const grantId = await transaction(async (q) => {
    await q(
      `insert into oauth_clients (client_id, kind, client_name) values ($1, 'device', $2)
       on conflict (client_id) do update set client_name = excluded.client_name`,
      [clientId, name]
    )
    await q(
      `delete from oauth_grants
        where user_id = $1 and client_id = $2 and resource = $3 and revoked_at is not null`,
      [userId, clientId, resource]
    )
    const { rows } = await q(
      `insert into oauth_grants (user_id, client_id, scope, resource) values ($1, $2, $3, $4)
       on conflict (user_id, client_id, resource) do update set scope = excluded.scope
       returning id`,
      [userId, clientId, SCOPE, resource]
    )
    return rows[0].id
  })
  return { grantId, clientId }
}

/**
 * POST /api/auth/device/poll { device_code, name? } (no auth).
 * 202 while the human has not approved yet. 201 once they have: a short-lived access token
 * (`xta_`, 1 hour, bound to `<origin>/api`) and a rotating refresh token (`xtr_`), refreshed at
 * POST /api/oauth/token. The GitHub access token is discarded after the profile is read.
 */
export async function pollDevice({ request }) {
  const body = await readJson(request, 10_000)
  if (!body || typeof body !== 'object' || typeof body.device_code !== 'string') {
    throw new HttpError(400, 'device_code is required')
  }
  const name = deviceName(body.name)

  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      device_code: body.device_code,
      grant_type: DEVICE_GRANT
    })
  })
  const data = await response.json().catch(() => ({}))

  if (data.error === 'authorization_pending' || data.error === 'slow_down') {
    return json({ status: 'pending', interval: data.interval ?? 5 }, 202)
  }
  if (data.error) throw new HttpError(400, data.error)
  if (!data.access_token) throw new HttpError(502, 'GitHub device sign-in failed')

  const github = await fetchGithubUser(data.access_token)
  const user = await upsertGithubUser(github)
  const { grantId, clientId } = await deviceGrant(user.id, name, apiResource(request))
  const pair = await issuePair(grantId)
  return json(
    {
      ...pair,
      // The refresh grant_type needs the client_id, so scripts store it with the refresh token.
      client_id: clientId,
      // Deprecated alias of access_token, kept for one release for scripts that read `token`.
      token: pair.access_token,
      user: { id: user.id, login: user.login, name: user.name, avatar_url: user.avatar_url }
    },
    201
  )
}

export const deviceRoutes = [
  { method: 'POST', path: '/auth/device/start', handler: startDevice },
  { method: 'POST', path: '/auth/device/poll', handler: pollDevice }
]
