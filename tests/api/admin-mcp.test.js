// @vitest-environment node
// Admin plan A3 (issue #183): admin tools are seen and run only by the elevated admin MCP connection.
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({ putBlob: vi.fn(), deleteBlobUrls: vi.fn(async () => {}) }))

import { route } from '../../server/router.js'
import { runAs } from '../../server/caller-context.js'
import { issuePair, resolveAccess } from '../../server/oauth/tokens.js'
import { ADMIN_TOOLS, ADMIN_NOTE, ADMIN_REST_ROUTES, listAdminTools } from '../../server/mcp/admin-tools.js'
import { listTools, callTool } from '../../server/mcp/tools.js'
import { isCleanServerText } from '../../server/mcp/language.js'
import { RATE_LIMIT_MESSAGE } from '../../server/mcp/rate.js'
import { APP_URL, setupTestDb } from './helpers/db.js'

const MCP = `${APP_URL}/api/mcp`
const CLIENT = 'xtc_admin_mcp_test'
const ADMIN_GITHUB_ID = 960015
const MODERN = '2026-07-28'
const LEGACY = '2025-11-25'
const HEBREW = /[֐-׿]/

let db
let admin
let normal

beforeAll(async () => {
  db = await setupTestDb()
})

beforeEach(async () => {
  await db.reset()
  await db.pg.exec('delete from oauth_clients')
  await db.pg.query("insert into oauth_clients (client_id, kind, client_name) values ($1, 'registered', 'Admin MCP test')", [CLIENT])
  admin = await db.insertUser({ github_id: ADMIN_GITHUB_ID, login: 'shaked' })
  normal = await db.insertUser({ github_id: 1, login: 'alice' })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

const future = () => new Date(Date.now() + 24 * 60 * 60 * 1000)
const past = () => new Date(Date.now() - 60 * 1000)

let grantCount = 0

/** A grant with its own client, so one user can hold several grants on the MCP resource. */
async function grantFor(user, { resource = MCP, adminUntil = null } = {}) {
  grantCount += 1
  const client = `${CLIENT}_${grantCount}`
  await db.pg.query("insert into oauth_clients (client_id, kind, client_name) values ($1, 'registered', 'Admin MCP test')", [client])
  const { rows } = await db.pg.query(
    'insert into oauth_grants (user_id, client_id, scope, resource, admin_until) values ($1, $2, $3, $4, $5) returning id',
    [user.id, client, 'drafts', resource, adminUntil]
  )
  return rows[0].id
}

/** The access token of a grant, and the caller that resolveAccess builds from it. */
async function tokenAndCaller(grantId) {
  const pair = await issuePair(grantId)
  return { token: pair.access_token, caller: await resolveAccess(pair.access_token, MCP) }
}

const elevated = async () => tokenAndCaller(await grantFor(admin, { adminUntil: future() }))

/** One JSON-RPC call on the given protocol version, with the bearer token. Returns the parsed body. */
async function rpc(version, token, method, params = {}) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` }
  let body
  if (version === MODERN) {
    headers['mcp-protocol-version'] = MODERN
    headers['mcp-method'] = method
    if (method === 'tools/call') headers['mcp-name'] = params.name
    body = { jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN } } }
  } else {
    if (method !== 'initialize') headers['mcp-protocol-version'] = version
    body = { jsonrpc: '2.0', id: 1, method, params }
  }
  const res = await route(new Request(MCP, { method: 'POST', headers, body: JSON.stringify(body) }))
  return JSON.parse(await res.text())
}

const toolNames = (body) => body.result.tools.map((tool) => tool.name)
const isAdminName = (name) => name.startsWith('admin_')

/** A REST call as the in-process caller, the way restAs makes it. Returns the Response. */
const restAs = (caller, method, path) => runAs(caller, () => route(new Request(`${APP_URL}/api${path}`, { method })))

describe.each([MODERN, LEGACY])('the admin tools are listed only for the elevated admin, protocol %s', (version) => {
  it('a normal user sees no admin tool, and the list is public', async () => {
    const { token } = await tokenAndCaller(await grantFor(normal))
    const body = await rpc(version, token, 'tools/list')
    expect(toolNames(body).filter(isAdminName)).toEqual([])
    expect(body.result.cacheScope).toBe('public')
  })

  it('no admin tool for a normal user, whatever admin_until holds', async () => {
    const normalFuture = await tokenAndCaller(await grantFor(normal, { adminUntil: future() }))
    const body = await rpc(version, normalFuture.token, 'tools/list')
    expect(toolNames(body).filter(isAdminName)).toEqual([])
    expect(body.result.cacheScope).toBe('public')
  })

  it('the admin gets the admin tools by identity alone: no admin_until, or one in the past', async () => {
    for (const adminUntil of [null, past()]) {
      const { token } = await tokenAndCaller(await grantFor(admin, { adminUntil }))
      const body = await rpc(version, token, 'tools/list')
      expect(toolNames(body).filter(isAdminName)).toHaveLength(8)
    }
  })

  it('the elevated admin sees the normal tools and admin_status, and the list is private', async () => {
    const { token } = await elevated()
    const body = await rpc(version, token, 'tools/list')
    const names = toolNames(body)
    expect(names).toContain('get_draft')
    expect(names).toContain('admin_status')
    expect(body.result.cacheScope).toBe('private')
  })

  it('the elevated admin runs admin_status and gets admin: true', async () => {
    const { token } = await elevated()
    const body = await rpc(version, token, 'tools/call', { name: 'admin_status', arguments: {} })
    expect(body.result.isError).toBe(false)
    expect(body.result.structuredContent.admin).toBe(true)
  })

  it('a normal user calling admin_status gets the same answer as for a name that does not exist', async () => {
    const { token } = await tokenAndCaller(await grantFor(normal))
    const real = await rpc(version, token, 'tools/call', { name: 'admin_status', arguments: {} })
    const made = await rpc(version, token, 'tools/call', { name: 'admin_zz', arguments: {} })
    expect(JSON.stringify(real).replaceAll('admin_status', 'NAME')).toEqual(JSON.stringify(made).replaceAll('admin_zz', 'NAME'))
    expect(real.error.code).toBe(-32602)
    expect(JSON.stringify(real)).not.toContain('"admin":true')
  })
})

describe('least privilege: a normal tool never reaches an admin route', () => {
  const hostile = ['..', '../admin/status', '%2e%2e/admin/status', 'x/../../admin/status']

  it.each(['get_draft', 'export_draft', 'delete_draft', 'update_draft'])('%s with path-like ids is not an admin answer', async (name) => {
    const { token } = await elevated()
    for (const id of hostile) {
      const args = name === 'update_draft' ? { id, title: 'x' } : { id }
      const body = await rpc(MODERN, token, 'tools/call', { name, arguments: args })
      const text = JSON.stringify(body)
      expect(text).not.toContain('"admin":true')
      expect(text).not.toContain('github_id')
    }
  })

  it('inside a normal tool run, the admin route answers 404 even for the elevated admin', async () => {
    const { caller } = await elevated()
    const res = await restAs({ ...caller, admin: false, adminTool: undefined }, 'GET', '/admin/status')
    expect(res.status).toBe(404)
  })

  it('a normal tool called by the elevated admin cannot reach /admin through its own rest', async () => {
    const { caller, token } = await elevated()
    const result = await callTool('whoami', {}, { caller, origin: APP_URL })
    expect(result.isError).toBe(false)
    const again = await rpc(MODERN, token, 'tools/call', { name: 'whoami', arguments: {} })
    expect(JSON.stringify(again)).not.toContain('"admin":true')
  })
})

describe('every admin tool is behind its admin route', () => {
  it.each(ADMIN_TOOLS.map((tool) => [tool.name, tool]))('%s: 404 from every route without adminTool, and not 404 with it', async (name, tool) => {
    const { caller } = await elevated()
    for (const key of ADMIN_REST_ROUTES[name]) {
      const [method, path] = key.split(' ')
      expect(path).not.toContain(':')
      const plain = await runAs({ ...caller, admin: false, adminTool: undefined }, async () => {
        return route(new Request(`${APP_URL}/api${path}`, { method }))
      })
      expect(plain.status).toBe(404)
    }
    const run = await tool.run({}, { rest: (method, path) => restAs({ ...caller, adminTool: name }, method, path) })
    expect(run.status).not.toBe(404)
  })
})

describe('wording of the admin tools', () => {
  it.each(listAdminTools().map((tool) => [tool.name, tool]))('%s reads well and is clean text', (_name, tool) => {
    expect(tool.description).toMatch(HEBREW)
    expect(tool.description.split('Hebrew: ').length - 1).toBe(1)
    expect(tool.description.endsWith(ADMIN_NOTE)).toBe(true)
    expect(tool.description.length).toBeLessThanOrEqual(600)
    expect(Buffer.byteLength(tool.description, 'utf8')).toBeLessThanOrEqual(1024)
    expect(isCleanServerText(tool.description)).toBe(true)
    expect(tool.title).not.toMatch(HEBREW)
    expect(isCleanServerText(tool.title)).toBe(true)
  })
})

describe('ADMIN_DISABLED switches admin tools off, even for the admin', () => {
  it('the elevated admin sees no admin tool', async () => {
    const { caller } = await elevated()
    vi.stubEnv('ADMIN_DISABLED', '1')
    const names = listTools(caller, APP_URL).map((tool) => tool.name)
    expect(names.filter(isAdminName)).toEqual([])
    const result = await callTool('admin_status', {}, { caller, origin: APP_URL })
    expect(result.isError).toBe(true)
  })
})

describe('admin calls are counted once per minute, in the same row as normal calls', () => {
  const callsNow = async (user) =>
    (await db.pg.query("select calls from mcp_rate_limits where user_id = $1 and minute = date_trunc('minute', now())", [user.id])).rows[0]?.calls

  it('one admin call counts exactly once', async () => {
    const { token } = await elevated()
    await rpc(MODERN, token, 'tools/call', { name: 'admin_status', arguments: {} })
    expect(await callsNow(admin)).toBe(1)
  })

  it('the 121st admin call in a minute is refused with the rate-limit message and does not run', async () => {
    const { token } = await elevated()
    await db.pg.query("insert into mcp_rate_limits (user_id, minute, calls) values ($1, date_trunc('minute', now()), 120)", [admin.id])
    const body = await rpc(MODERN, token, 'tools/call', { name: 'admin_status', arguments: {} })
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toBe(RATE_LIMIT_MESSAGE)
    expect(await callsNow(admin)).toBe(121)
  })

  it('an admin_ name from a caller who is not the admin is not counted', async () => {
    const { token } = await tokenAndCaller(await grantFor(normal))
    await rpc(MODERN, token, 'tools/call', { name: 'admin_status', arguments: {} })
    expect(await callsNow(normal)).toBeUndefined()
  })
})
