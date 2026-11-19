// @vitest-environment node
// Admin plan A2: the guard. Everyone but the elevated admin MCP caller gets the same 404 as an unknown path.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({ putBlob: vi.fn(), deleteBlobUrls: vi.fn(async () => {}) }))

import { ROUTES, route } from '../../server/router.js'
import { adminRoute, isGuardedAdminHandler } from '../../server/admin/guard.js'
import { runAs } from '../../server/caller-context.js'
import { ciAudience, OIDC_ISSUER, setJwksForTests, verifyCiToken } from '../../server/oidc-ci.js'
import { resolveAccess, issuePair } from '../../server/oauth/tokens.js'
import { createApiToken } from '../../server/tokens.js'
import { adminRoutes } from '../../server/routes/admin.js'
import { apiRequest, setupTestDb, APP_URL } from './helpers/db.js'

const API = `${APP_URL}/api`
const MCP = `${APP_URL}/api/mcp`
const CLIENT = 'xtc_guard_client'
const ADMIN_GITHUB_ID = 960015
const REPO_ID = '1136002672'
const WORKFLOW_REF = 'Shaked/x-thread-draft-tool/.github/workflows/smoke-deployed.yml@refs/heads/main'
const CI_ENV = { CI_OIDC_ENABLED: '1', VERCEL_ENV: 'preview', CI_OIDC_REPOSITORY_ID: REPO_ID, CI_OIDC_ALLOW_BRANCHES: '1' }

let db
let admin
let normal
let signingKey

beforeAll(async () => {
  db = await setupTestDb()
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  signingKey = privateKey
  setJwksForTests(createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'guard-kid', alg: 'RS256', use: 'sig' }] }))
})

beforeEach(async () => {
  await db.reset()
  await db.pg.exec('delete from oauth_clients')
  await db.pg.query("insert into oauth_clients (client_id, kind, client_name) values ($1, 'registered', 'Guard')", [CLIENT])
  admin = await db.insertUser({ github_id: ADMIN_GITHUB_ID, login: 'shaked' })
  normal = await db.insertUser({ github_id: 1, login: 'alice' })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

const future = () => new Date(Date.now() + 24 * 60 * 60 * 1000)

async function newGrant(userId, { resource = MCP, adminUntil = null } = {}) {
  const { rows } = await db.pg.query(
    `insert into oauth_grants (user_id, client_id, scope, resource, admin_until) values ($1, $2, 'drafts', $3, $4) returning id`,
    [userId, CLIENT, resource, adminUntil]
  )
  return rows[0].id
}

/** The caller of an elevated admin MCP grant, as authorizeAndCount builds it (via resolveAccess here). */
async function elevatedCaller() {
  const pair = await issuePair(await newGrant(admin.id, { adminUntil: future() }))
  return { caller: await resolveAccess(pair.access_token, MCP), token: pair.access_token }
}

/** A signed CI identity token that verifies (same setup as tests/api/oidc-ci.test.js). */
async function ciToken() {
  const now = Math.floor(Date.now() / 1000)
  const jwt = await new SignJWT({
    repository_id: REPO_ID,
    workflow_ref: WORKFLOW_REF,
    job_workflow_ref: WORKFLOW_REF,
    event_name: 'workflow_dispatch',
    ref: 'refs/heads/main',
    runner_environment: 'github-hosted'
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'guard-kid' })
    .setIssuer(OIDC_ISSUER)
    .setAudience(ciAudience('preview'))
    .setSubject('repo:Shaked/x-thread-draft-tool:ref:refs/heads/main')
    .setNotBefore(now - 5)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(signingKey)
  return jwt
}

/** Every network caller the guard must refuse, as headers for apiRequest. */
async function networkCallers() {
  vi.stubEnv('CI_OIDC_ENABLED', CI_ENV.CI_OIDC_ENABLED)
  vi.stubEnv('VERCEL_ENV', CI_ENV.VERCEL_ENV)
  vi.stubEnv('CI_OIDC_REPOSITORY_ID', CI_ENV.CI_OIDC_REPOSITORY_ID)
  vi.stubEnv('CI_OIDC_ALLOW_BRANCHES', CI_ENV.CI_OIDC_ALLOW_BRANCHES)
  const ci = await ciToken()
  expect(await verifyCiToken(ci)).not.toBeNull()

  const apiGrant = await issuePair(await newGrant(admin.id, { resource: API, adminUntil: future() }))
  const mcpGrant = await issuePair(await newGrant(admin.id, { adminUntil: future() }))
  const adminToken = await createApiToken(admin.id, { name: 'guard test' })
  return {
    nobody: {},
    'normal user cookie': { cookie: await db.cookieFor(normal) },
    'admin cookie': { cookie: await db.cookieFor(admin) },
    'admin xt_ token': { headers: { authorization: `Bearer ${adminToken.token}` } },
    'admin xta_ token for the REST resource, admin_until set': { headers: { authorization: `Bearer ${apiGrant.access_token}` } },
    'admin xta_ token for the MCP resource sent to REST': { headers: { authorization: `Bearer ${mcpGrant.access_token}` } },
    'signed CI token': { headers: { authorization: `Bearer ${ci}` } },
    'bogus bearer': { headers: { authorization: 'Bearer not-a-token' } }
  }
}

const bodyOf = async (res) => ({ status: res.status, text: await res.text() })

describe('the guard answers 404 to everyone but the elevated admin MCP caller', () => {
  it('matches the unknown-route answer for every admin route, method and caller', async () => {
    const adminEntries = ROUTES.filter((entry) => entry.path.startsWith('/admin'))
    expect(adminEntries.length).toBeGreaterThan(0)
    for (const [name, opts] of Object.entries(await networkCallers())) {
      const unknown = await bodyOf(await route(apiRequest('/api/zz-no-such-route', opts)))
      expect(unknown.status).toBe(404)
      for (const entry of adminEntries) {
        for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
          const got = await bodyOf(await route(apiRequest(`/api${entry.path}`, { ...opts, method })))
          expect({ caller: name, method, path: entry.path, ...got }).toEqual({ caller: name, method, path: entry.path, ...unknown })
        }
      }
    }
  })

  it('treats the rewrite parameter the same way', async () => {
    const unknown = await bodyOf(await route(apiRequest('/api/zz-no-such-route')))
    for (const [name, opts] of Object.entries(await networkCallers())) {
      const got = await bodyOf(await route(apiRequest('/api/health?__path=admin/status', opts)))
      expect({ caller: name, ...got }).toEqual({ caller: name, ...unknown })
    }
  })

  it('refuses an admin path even when the caller is the admin on a cookie (no admin on sessions)', async () => {
    const res = await route(apiRequest('/api/admin/status', { cookie: await db.cookieFor(admin) }))
    expect(res.status).toBe(404)
  })
})

describe('the admin route is built only by adminRoute', () => {
  it('marks every admin route and nothing else', () => {
    for (const entry of ROUTES) {
      if (entry.path.startsWith('/admin')) {
        expect(entry.admin).toBe(true)
        expect(isGuardedAdminHandler(entry.handler)).toBe(true)
        expect(entry.ci).toBeUndefined()
        expect(entry.selfAuth).toBeUndefined()
      } else {
        expect(entry.admin).toBeUndefined()
      }
    }
  })

  it('exports only adminRoutes from server/routes/admin.js', async () => {
    expect(Object.keys(await import('../../server/routes/admin.js'))).toEqual(['adminRoutes'])
    expect(adminRoutes.length).toBeGreaterThan(0)
  })

  it('refuses a route path outside /admin', () => {
    expect(() => adminRoute('GET', '/users', () => new Response(null))).toThrow()
  })
})

describe('an elevated admin MCP caller gets through', () => {
  it('answers 200 for GET /api/admin/status inside runAs with an admin tool', async () => {
    const { caller } = await elevatedCaller()
    const res = await runAs({ ...caller, adminTool: 'admin_status' }, () => route(apiRequest('/api/admin/status')))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ admin: true, login: 'shaked', github_id: String(ADMIN_GITHUB_ID) })
  })

  it.each([
    ['adminTool is not set', (c) => ({ ...c })],
    ['adminTool is a normal tool', (c) => ({ ...c, adminTool: 'get_draft' })],
    ['admin is false', (c) => ({ ...c, adminTool: 'admin_status', admin: false })],
    ['the GitHub id is not the admin', (c) => ({ ...c, adminTool: 'admin_status', gh: '5' })],
    ['via a token rather than OAuth', (c) => ({ ...c, adminTool: 'admin_status', via: 'token' })],
    ['via a browser session', (c) => ({ ...c, adminTool: 'admin_status', via: 'session' })],
    ['the resource is the REST resource', (c) => ({ ...c, adminTool: 'admin_status', resource: API })],
    ['the resource is not set', (c) => {
      const copy = { ...c, adminTool: 'admin_status' }
      delete copy.resource
      return copy
    }]
  ])('answers the unknown-route 404 when %s', async (_name, change) => {
    const { caller } = await elevatedCaller()
    const unknown = await bodyOf(await route(apiRequest('/api/zz-no-such-route')))
    const got = await bodyOf(await runAs(change(caller), () => route(apiRequest('/api/admin/status'))))
    expect(got).toEqual(unknown)
  })

  it('answers the unknown-route 404 when the request carries an Authorization header', async () => {
    const { caller, token } = await elevatedCaller()
    const unknown = await bodyOf(await route(apiRequest('/api/zz-no-such-route')))
    const req = apiRequest('/api/admin/status', { headers: { authorization: `Bearer ${token}` } })
    const got = await bodyOf(await runAs({ ...caller, adminTool: 'admin_status' }, () => route(req)))
    expect(got).toEqual(unknown)
  })

  it('answers the unknown-route 404 when ADMIN_DISABLED=1', async () => {
    const { caller } = await elevatedCaller()
    vi.stubEnv('ADMIN_DISABLED', '1')
    const unknown = await bodyOf(await route(apiRequest('/api/zz-no-such-route')))
    const got = await bodyOf(await runAs({ ...caller, adminTool: 'admin_status' }, () => route(apiRequest('/api/admin/status'))))
    expect(got).toEqual(unknown)
  })
})

describe('resolveAccess reports the resource and the elevation', () => {
  it('a REST token never gets admin, even when admin_until is in the future', async () => {
    const pair = await issuePair(await newGrant(admin.id, { resource: API, adminUntil: future() }))
    expect(await resolveAccess(pair.access_token, API)).toMatchObject({ admin: false, resource: API })
  })

  it('an elevated MCP token gets admin, for the MCP resource only', async () => {
    const pair = await issuePair(await newGrant(admin.id, { adminUntil: future() }))
    expect(await resolveAccess(pair.access_token, MCP)).toMatchObject({ admin: true, resource: MCP })
    expect(await resolveAccess(pair.access_token, API)).toBeNull()
  })

  it('an expired elevation is not admin', async () => {
    const pair = await issuePair(await newGrant(admin.id, { adminUntil: new Date(Date.now() - 60_000) }))
    expect(await resolveAccess(pair.access_token, MCP)).toMatchObject({ admin: false })
  })
})

describe('runAs is called only by the MCP server and its tool runner', () => {
  it('finds runAs( only in server/mcp/server.js and server/mcp/tools.js', () => {
    const root = fileURLToPath(new URL('../..', import.meta.url))
    const files = []
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.m?js$/.test(name)) files.push(path)
      }
    }
    for (const dir of ['server', 'api', 'scripts']) walk(join(root, dir))
    const callers = files
      .filter((file) => !file.endsWith('caller-context.js') && /\brunAs\(/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(root, file))
      .sort()
    expect(callers).toEqual(['server/mcp/server.js', 'server/mcp/tools.js'])
  })
})
