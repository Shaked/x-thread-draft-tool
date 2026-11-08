// @vitest-environment node
// Agent scripts (plan Task 7.7): the device login stores a pair, and the access token refreshes
// when it expires. fetch is always a mock; nothing touches the network.
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACCESS_MARGIN_MS,
  CredentialsError,
  getAccessToken,
  loginWithDevice,
  readCredentials
} from '../../scripts/agent-credentials.mjs'

const BASE = 'https://app.example.test'
const NOW = 1_800_000_000_000
const ACCESS_1 = `xta_${'a'.repeat(43)}`
const REFRESH_1 = `xtr_${'b'.repeat(43)}`
const ACCESS_2 = `xta_${'c'.repeat(43)}`
const REFRESH_2 = `xtr_${'d'.repeat(43)}`

let dir
let file

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'xt-agent-test-'))
  file = path.join(dir, 'xt', 'credentials.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const pair = (access, refresh) => ({
  access_token: access,
  refresh_token: refresh,
  token_type: 'Bearer',
  expires_in: 3600,
  scope: 'drafts',
  client_id: 'device:claude'
})

/** Stored credentials as the login writes them, expiring at `expiresAt` (epoch ms). */
function storedAt(expiresAt, access = ACCESS_1, refresh = REFRESH_1) {
  return { base_url: BASE, client_id: 'device:claude', refresh_token: refresh, access_token: access, access_expires_at: expiresAt }
}

async function writeStored(data) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(data))
}

describe('loginWithDevice', () => {
  it('starts, polls until approved, saves the pair with mode 600, and prints no token', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, { device_code: 'dev-1', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 1, expires_in: 900 })
      )
      .mockResolvedValueOnce(jsonResponse(202, { status: 'pending', interval: 2 }))
      .mockResolvedValueOnce(jsonResponse(201, { ...pair(ACCESS_1, REFRESH_1), user: { login: 'octo' } }))
    const log = vi.fn()
    const sleep = vi.fn(async () => {})

    const stored = await loginWithDevice({ base: `${BASE}/`, name: 'claude', file, fetchImpl, sleep, now: () => NOW, log })

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      `${BASE}/api/auth/device/start`,
      `${BASE}/api/auth/device/poll`,
      `${BASE}/api/auth/device/poll`
    ])
    expect(JSON.parse(fetchImpl.mock.calls[2][1].body)).toEqual({ device_code: 'dev-1', name: 'claude' })
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000])
    expect(log).toHaveBeenCalledWith('Open https://github.com/login/device and enter: ABCD-1234')
    expect(JSON.stringify(log.mock.calls)).not.toContain(ACCESS_1)

    expect(stored).toEqual({
      base_url: BASE,
      client_id: 'device:claude',
      refresh_token: REFRESH_1,
      access_token: ACCESS_1,
      access_expires_at: NOW + 3600 * 1000
    })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(stored)
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect((await stat(path.dirname(file))).mode & 0o777).toBe(0o700)
  })

  it('throws a CredentialsError when the human denies the request', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { device_code: 'dev-1', user_code: 'X', interval: 1, expires_in: 900 }))
      .mockResolvedValueOnce(jsonResponse(400, { error: 'access_denied' }))

    await expect(
      loginWithDevice({ base: BASE, name: 'claude', file, fetchImpl, sleep: async () => {}, now: () => NOW, log: () => {} })
    ).rejects.toThrow('Sign-in failed: access_denied')
    await expect(readFile(file, 'utf8')).rejects.toThrow()
  })
})

describe('getAccessToken', () => {
  it('returns the stored access token without any request while it is fresh', async () => {
    await writeStored(storedAt(NOW + 10 * 60 * 1000))
    const fetchImpl = vi.fn()
    expect(await getAccessToken({ file, fetchImpl, now: () => NOW })).toBe(ACCESS_1)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refreshes when the access token has expired, and saves the rotated refresh token', async () => {
    await writeStored(storedAt(NOW - 1000))
    const fetchImpl = vi.fn(async () => jsonResponse(200, pair(ACCESS_2, REFRESH_2)))

    expect(await getAccessToken({ file, fetchImpl, now: () => NOW })).toBe(ACCESS_2)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(`${BASE}/api/oauth/token`)
    expect(init.method).toBe('POST')
    expect(init.headers['content-type']).toBe('application/x-www-form-urlencoded')
    const sent = new URLSearchParams(init.body)
    expect(Object.fromEntries(sent)).toEqual({ grant_type: 'refresh_token', refresh_token: REFRESH_1, client_id: 'device:claude' })

    const saved = await readCredentials(file)
    expect(saved).toEqual({
      base_url: BASE,
      client_id: 'device:claude',
      refresh_token: REFRESH_2,
      access_token: ACCESS_2,
      access_expires_at: NOW + 3600 * 1000
    })
    expect(JSON.stringify(saved)).not.toContain(REFRESH_1)
    expect((await stat(file)).mode & 0o777).toBe(0o600)
  })

  it('refreshes inside the safety margin before expiry, so a slow request never starts expired', async () => {
    await writeStored(storedAt(NOW + ACCESS_MARGIN_MS - 1))
    const fetchImpl = vi.fn(async () => jsonResponse(200, pair(ACCESS_2, REFRESH_2)))
    expect(await getAccessToken({ file, fetchImpl, now: () => NOW })).toBe(ACCESS_2)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('a second refresh uses the rotated refresh token, not the first one', async () => {
    await writeStored(storedAt(NOW - 1))
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, pair(ACCESS_2, REFRESH_2)))
      .mockResolvedValueOnce(jsonResponse(200, pair(ACCESS_1, REFRESH_1)))
    await getAccessToken({ file, fetchImpl, now: () => NOW })
    await getAccessToken({ file, fetchImpl, now: () => NOW + 2 * 60 * 60 * 1000 })
    expect(new URLSearchParams(fetchImpl.mock.calls[1][1].body).get('refresh_token')).toBe(REFRESH_2)
  })

  it('concurrent callers with an expired token refresh once and the grant is not revoked', async () => {
    await writeStored(storedAt(NOW - 1000))
    // A stand-in for the server's rotation: presenting a spent refresh token revokes the grant.
    let current = REFRESH_1
    let revoked = false
    let issued = 0
    const fetchImpl = vi.fn(async (_url, init) => {
      const presented = new URLSearchParams(init.body).get('refresh_token')
      await new Promise((resolve) => setTimeout(resolve, 50))
      if (revoked || presented !== current) {
        revoked = true
        return jsonResponse(400, { error: 'invalid_grant' })
      }
      issued += 1
      current = `xtr_${String(issued).repeat(43)}`
      return jsonResponse(200, pair(`xta_${String(issued).repeat(43)}`, current))
    })

    const results = await Promise.all([
      getAccessToken({ file, fetchImpl, now: () => NOW }),
      getAccessToken({ file, fetchImpl, now: () => NOW }),
      getAccessToken({ file, fetchImpl, now: () => NOW })
    ])

    expect(revoked).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(new Set(results)).toEqual(new Set([`xta_${'1'.repeat(43)}`]))
    expect((await readCredentials(file)).refresh_token).toBe(current)
  })

  it('releases the lock when the refresh fails, so the next caller is not blocked', async () => {
    await writeStored(storedAt(NOW - 1))
    const failing = vi.fn(async () => jsonResponse(400, { error: 'invalid_grant' }))
    await expect(getAccessToken({ file, fetchImpl: failing, now: () => NOW })).rejects.toThrow('Could not refresh')
    const ok = vi.fn(async () => jsonResponse(200, pair(ACCESS_2, REFRESH_2)))
    expect(await getAccessToken({ file, fetchImpl: ok, now: () => NOW })).toBe(ACCESS_2)
  })

  it('takes over a stale lock left by a crashed process', async () => {
    await writeStored(storedAt(NOW - 1))
    await writeFile(`${file}.lock`, '99999')
    const old = new Date(Date.now() - 10 * 60 * 1000)
    await utimes(`${file}.lock`, old, old)
    const ok = vi.fn(async () => jsonResponse(200, pair(ACCESS_2, REFRESH_2)))
    expect(await getAccessToken({ file, fetchImpl: ok, now: () => NOW })).toBe(ACCESS_2)
  })

  it('gives up with a CredentialsError when a live lock is never released', async () => {
    await writeStored(storedAt(NOW - 1))
    await writeFile(`${file}.lock`, '99999')
    const fetchImpl = vi.fn()
    await expect(getAccessToken({ file, fetchImpl, now: () => NOW, lockWaitMs: 150, lockStaleMs: 60_000 })).rejects.toThrow(
      'Timed out waiting for another xt command'
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('a refused refresh throws a CredentialsError that says to log in again, without the token', async () => {
    await writeStored(storedAt(NOW - 1))
    const fetchImpl = vi.fn(async () => jsonResponse(400, { error: 'invalid_grant', error_description: 'x' }))

    const error = await getAccessToken({ file, fetchImpl, now: () => NOW }).catch((err) => err)
    expect(error).toBeInstanceOf(CredentialsError)
    expect(error.message).toBe('Could not refresh the access token (invalid_grant). Run npm run agent:login.')
    expect(error.message).not.toContain(REFRESH_1)
    // The stored pair is left alone when the refresh fails.
    expect((await readCredentials(file)).refresh_token).toBe(REFRESH_1)
  })

  it('throws a CredentialsError when nothing has been logged in yet', async () => {
    await expect(getAccessToken({ file, fetchImpl: vi.fn(), now: () => NOW })).rejects.toThrow(
      `No credentials in ${file}. Run npm run agent:login.`
    )
  })

  it('rejects a credentials file that is not valid JSON or has no refresh token', async () => {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, '{not json')
    await expect(readCredentials(file)).rejects.toThrow('is not valid JSON')
    await writeFile(file, JSON.stringify({ base_url: BASE, client_id: 'device:claude' }))
    await expect(readCredentials(file)).rejects.toThrow('has no refresh token')
  })
})

describe('xt-token command', () => {
  it('exits 1 with the login hint when there are no credentials', async () => {
    const script = fileURLToPath(new URL('../../scripts/xt-token.mjs', import.meta.url))
    const result = await new Promise((resolve) => {
      execFile(process.execPath, [script], { env: { ...process.env, XT_CREDENTIALS_FILE: file } }, (error, stdout, stderr) => {
        resolve({ code: error ? error.code : 0, stdout, stderr })
      })
    })
    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('npm run agent:login')
  })
})
