// Local credentials for the agent scripts (plan Task 7.7). The device flow issues a 1-hour access
// token (xta_) and a rotating refresh token (xtr_). This module keeps them in one file and
// refreshes the access token when it is about to expire. The CLI entry points are
// scripts/agent-login.mjs and scripts/xt-token.mjs. The logic lives here so tests can mock fetch.
//
// Stored file (mode 600, directory 700): { base_url, client_id, refresh_token, access_token, access_expires_at }
// access_expires_at is epoch milliseconds. Refreshing rotates refresh_token, so the file is rewritten
// on every refresh.
import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

// Refresh this long before the access token's expiry, so a slow request does not start expired.
export const ACCESS_MARGIN_MS = 60_000
const HINT = 'Run npm run agent:login.'

// Lock around read, refresh and save. A refresh is one HTTP call, so a lock older than the stale
// limit belongs to a crashed process. A waiter gives up after the wait limit instead of hanging.
export const LOCK_STALE_MS = 60_000
export const LOCK_WAIT_MS = 30_000
const LOCK_POLL_MS = 50

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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Removes the lock only when it still holds our token, so a taken-over lock is never deleted. */
async function releaseLock(lockPath, owner) {
  try {
    if ((await readFile(lockPath, 'utf8')) === owner) await unlink(lockPath)
  } catch {
    // Already gone, or taken over after it went stale. Nothing to release.
  }
}

/** Moves a lock older than staleMs out of the way. Returns true when it did. */
async function breakStaleLock(lockPath, staleMs) {
  try {
    const info = await stat(lockPath)
    if (Date.now() - info.mtimeMs <= staleMs) return false
    // rename is atomic, so only one waiter removes the stale lock.
    const moved = `${lockPath}.stale-${process.pid}-${randomBytes(4).toString('hex')}`
    await rename(lockPath, moved)
    await unlink(moved).catch(() => {})
    return true
  } catch {
    return true // It vanished meanwhile; retry the exclusive create.
  }
}

/**
 * Runs fn while holding a cross-process lock next to the credentials file. The lock is a file
 * created with the exclusive flag (wx), released in finally on every path.
 */
export async function withCredentialsLock(file, fn, { waitMs = LOCK_WAIT_MS, staleMs = LOCK_STALE_MS } = {}) {
  const lockPath = `${file}.lock`
  const owner = `${process.pid}:${randomBytes(8).toString('hex')}`
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const deadline = Date.now() + waitMs
  for (;;) {
    try {
      await writeFile(lockPath, owner, { flag: 'wx', mode: 0o600 })
      break
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
    }
    if (await breakStaleLock(lockPath, staleMs)) continue
    if (Date.now() >= deadline) {
      throw new CredentialsError(`Timed out waiting for another xt command to finish refreshing (${lockPath}). Try again.`)
    }
    await delay(LOCK_POLL_MS)
  }
  try {
    return await fn()
  } finally {
    await releaseLock(lockPath, owner)
  }
}

/**
 * Returns a valid access token. It uses the stored one while it is fresh; otherwise it takes the
 * lock, re-reads the file (another command may have refreshed while this one waited) and only then
 * refreshes and saves the rotated pair. Throws CredentialsError when there is nothing to refresh.
 */
export async function getAccessToken({
  file = credentialsFile(),
  fetchImpl = fetch,
  now = Date.now,
  lockWaitMs = LOCK_WAIT_MS,
  lockStaleMs = LOCK_STALE_MS
} = {}) {
  const isFresh = (c) => c.access_token && c.access_expires_at - ACCESS_MARGIN_MS > now()

  const stored = await readCredentials(file)
  if (!stored) throw new CredentialsError(`No credentials in ${file}. ${HINT}`)
  if (isFresh(stored)) return stored.access_token

  return withCredentialsLock(
    file,
    async () => {
      // Re-read under the lock: a command that held it first has already spent the old refresh token.
      const current = await readCredentials(file)
      if (!current) throw new CredentialsError(`No credentials in ${file}. ${HINT}`)
      if (isFresh(current)) return current.access_token
      const fresh = await refreshCredentials(current, { fetchImpl, now: now() })
      await writeCredentials(file, fresh)
      return fresh.access_token
    },
    { waitMs: lockWaitMs, staleMs: lockStaleMs }
  )
}
