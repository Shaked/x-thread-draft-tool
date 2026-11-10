// Local credentials for the agent scripts (plan Task 7.7). The device flow issues a 1-hour access
// token (xta_) and a rotating refresh token (xtr_). This module keeps them in one file and
// refreshes the access token when it is about to expire. The CLI entry points are
// scripts/agent-login.mjs and scripts/xt-token.mjs. The logic lives here so tests can mock fetch.
//
// Stored file (mode 600, directory 700): { base_url, client_id, refresh_token, access_token, access_expires_at }
// access_expires_at is epoch milliseconds. Refreshing rotates refresh_token, so the file is rewritten
// on every refresh.
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

// Refresh this long before the access token's expiry, so a slow request does not start expired.
export const ACCESS_MARGIN_MS = 60_000
const HINT = 'Run npm run agent:login.'

export class CredentialsError extends Error {
  constructor(message) {
    super(message)
    this.name = 'CredentialsError'
  }
}

/** XT_CREDENTIALS_FILE overrides the default ~/.config/xt/credentials.json. */
export function credentialsFile() {
  return process.env.XT_CREDENTIALS_FILE || path.join(homedir(), '.config', 'xt', 'credentials.json')
}

/** Returns the stored credentials, or null when the file does not exist. */
export async function readCredentials(file) {
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new CredentialsError(`${file} is not valid JSON. ${HINT}`)
  }
  if (!data || typeof data.base_url !== 'string' || typeof data.client_id !== 'string' || typeof data.refresh_token !== 'string') {
    throw new CredentialsError(`${file} has no refresh token. ${HINT}`)
  }
  return data
}

/** Writes the credentials with mode 600 in a directory with mode 700. */
export async function writeCredentials(file, data) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
  await chmod(file, 0o600)
}

/** Builds the stored record from a token response. `now` is epoch milliseconds. */
function toStored(base, clientId, tokens, now) {
  return {
    base_url: base,
    client_id: clientId,
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    access_expires_at: now + tokens.expires_in * 1000
  }
}

async function postJson(fetchImpl, url, body) {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body)
  })
  const data = await response.json().catch(() => ({}))
  return { status: response.status, data }
}

/**
 * Signs in through GitHub's device flow and saves the pair. `log` receives the sign-in prompt
 * (the user code and URL). The token is never logged. Throws CredentialsError on failure.
 */
export async function loginWithDevice({
  base,
  name,
  file = credentialsFile(),
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  log = console.log
}) {
  const origin = base.replace(/\/$/, '')
  const started = await postJson(fetchImpl, `${origin}/api/auth/device/start`, {})
  if (started.status !== 200) throw new CredentialsError(`Could not start device sign-in (HTTP ${started.status}).`)
  const { device_code: deviceCode, user_code: userCode, verification_uri: verifyUrl, interval, expires_in: expiresIn } = started.data

  log(`Open ${verifyUrl || 'https://github.com/login/device'} and enter: ${userCode}`)

  const deadline = now() + (expiresIn ?? 900) * 1000
  let waitSeconds = interval ?? 5
  while (now() < deadline) {
    await sleep(waitSeconds * 1000)
    const polled = await postJson(fetchImpl, `${origin}/api/auth/device/poll`, { device_code: deviceCode, name })
    if (polled.status === 202) {
      waitSeconds = polled.data.interval ?? waitSeconds
      continue
    }
    if (polled.status === 201) {
      const stored = toStored(origin, polled.data.client_id, polled.data, now())
      await writeCredentials(file, stored)
      return stored
    }
    throw new CredentialsError(`Sign-in failed: ${polled.data.error || `HTTP ${polled.status}`}`)
  }
  throw new CredentialsError('The code expired before it was approved. Run the command again.')
}

/** Exchanges the stored refresh token for a new pair. The old refresh token is spent. */
export async function refreshCredentials(stored, { fetchImpl = fetch, now = Date.now() } = {}) {
  const response = await fetchImpl(`${stored.base_url}/api/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: stored.refresh_token,
      client_id: stored.client_id
    })
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.access_token || !data.refresh_token) {
    throw new CredentialsError(`Could not refresh the access token (${data.error || `HTTP ${response.status}`}). ${HINT}`)
  }
  return toStored(stored.base_url, stored.client_id, data, now)
}

/**
 * Returns a valid access token. It uses the stored one while it is fresh; otherwise it refreshes
 * and saves the rotated pair first. Throws CredentialsError when there is nothing to refresh.
 */
export async function getAccessToken({ file = credentialsFile(), fetchImpl = fetch, now = Date.now } = {}) {
  const stored = await readCredentials(file)
  if (!stored) throw new CredentialsError(`No credentials in ${file}. ${HINT}`)
  if (stored.access_token && stored.access_expires_at - ACCESS_MARGIN_MS > now()) return stored.access_token

  const fresh = await refreshCredentials(stored, { fetchImpl, now: now() })
  await writeCredentials(file, fresh)
  return fresh.access_token
}
