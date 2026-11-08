import { HttpError, json, readJson } from '../http.js'
import { fetchGithubUser, upsertGithubUser } from '../github-user.js'
import { createApiToken } from '../tokens.js'

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'
const JSON_HEADERS = { accept: 'application/json', 'content-type': 'application/json' }

/**
 * POST /api/auth/device/start (no auth). Starts GitHub's device flow for an agent.
 * The agent shows the user `user_code` and `verification_uri`, then polls /poll.
 * Needs "Enable Device Flow" on the GitHub OAuth App; no client secret is used.
 */
async function startDevice() {
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

/**
 * POST /api/auth/device/poll { device_code, name? } (no auth).
 * 202 while the human has not approved yet; 201 with a new API token once they have.
 * The GitHub access token is discarded after the profile is read.
 */
async function pollDevice({ request }) {
  const body = await readJson(request, 10_000)
  if (!body || typeof body !== 'object' || typeof body.device_code !== 'string') {
    throw new HttpError(400, 'device_code is required')
  }

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
  const created = await createApiToken(user.id, {
    name: typeof body.name === 'string' && body.name.trim() ? body.name : 'Device token',
    via: 'device'
  })
  return json(
    {
      token: created.token,
      expires_at: created.expires_at,
      user: { id: user.id, login: user.login, name: user.name, avatar_url: user.avatar_url }
    },
    201
  )
}

export const deviceRoutes = [
  { method: 'POST', path: '/auth/device/start', handler: startDevice },
  { method: 'POST', path: '/auth/device/poll', handler: pollDevice }
]
