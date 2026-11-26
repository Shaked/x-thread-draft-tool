// @vitest-environment node
// #483: the admin's feature flags over REST (the owner's browser session) and MCP (admin_list_flags, admin_set_flag).
// Signed out and a normal user get the 404 of an unknown path; a change writes one audit row and touches only the admin's own row.
import { beforeAll, describe, expect, it } from 'vitest'
import { route } from '../../server/router.js'
import { runAs } from '../../server/caller-context.js'
import { issuePair, resolveAccess } from '../../server/oauth/tokens.js'
import { ADMIN_TOOLS } from '../../server/mcp/admin-tools.js'
import { apiRequest, setupTestDb, APP_URL } from './helpers/db.js'

const MCP = `${APP_URL}/api/mcp`
const HEADER = { 'x-xt-admin': '1' }

let db
let admin
let normal
let adminCookie
let normalCookie

beforeAll(async () => {
  db = await setupTestDb()
  await db.reset()
  await db.pg.exec('delete from oauth_clients')
  admin = await db.insertUser({ github_id: 960015, login: 'shaked' })
  normal = await db.insertUser({ github_id: 1, login: 'alice' })
  adminCookie = await db.cookieFor(admin)
  normalCookie = await db.cookieFor(normal)
})

const web = (method, cookie, body) => route(apiRequest('/api/admin/flags', { method, cookie, headers: cookie ? HEADER : {}, body }))
const auditRows = async () => (await db.pg.query("select * from admin_audit where action = 'set_flag' order by created_at")).rows

async function mcpCaller() {
  await db.pg.query("insert into oauth_clients (client_id, kind, client_name, redirect_uris) values ('xtc_flags', 'registered', 'Flags test', $1) on conflict do nothing", [['https://claude.ai/api/mcp/auth_callback']])
  const { rows } = await db.pg.query(
    "insert into oauth_grants (user_id, client_id, scope, resource, admin_until) values ($1, 'xtc_flags', 'drafts', $2, now() + interval '1 day') returning id",
    [admin.id, MCP]
  )
  return resolveAccess((await issuePair(rows[0].id)).access_token, MCP)
}

describe('who may use the flags', () => {
  it('signed out and a normal user get the unknown-path 404 for both routes', async () => {
    for (const method of ['GET', 'POST']) {
      const body = method === 'POST' ? { name: 'look', value: 'rare' } : undefined
      expect((await web(method, undefined, body)).status, `${method} signed out`).toBe(404)
      expect((await web(method, normalCookie, body)).status, `${method} normal user`).toBe(404)
      // The admin's own cookie without the browser header is refused too.
      expect((await route(apiRequest('/api/admin/flags', { method, cookie: adminCookie, body }))).status, `${method} no header`).toBe(404)
    }
    expect(await auditRows()).toHaveLength(0)
    const { rows } = await db.pg.query('select ui_flags from users')
    expect(rows.every((row) => Object.keys(row.ui_flags).length === 0)).toBe(true)
  })
})

describe('the admin over REST', () => {
  it('lists both flags with value, allowed values, default and meaning', async () => {
    const res = await web('GET', adminCookie)
    expect(res.status).toBe(200)
    const { flags } = await res.json()
    expect(flags.map((f) => [f.name, f.value, f.values, f.default])).toEqual([
      ['look', 'rare', ['rare', 'default'], 'rare'],
      ['components', 'rare', ['rare', 'default'], 'rare']
    ])
    expect(flags.every((f) => f.meaning.length > 10)).toBe(true)
  })

  it('sets the admin off switch (the old look) for the admin only, and writes one audit row', async () => {
    const res = await web('POST', adminCookie, { name: 'look', value: 'default' })
    expect(res.status).toBe(200)
    expect((await res.json()).flags.find((f) => f.name === 'look').value).toBe('default')
    expect((await (await web('GET', adminCookie)).json()).flags.find((f) => f.name === 'look').value).toBe('default')
    const rows = await auditRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ outcome: 'done', actor_login: 'shaked', target_user_id: null })
    expect(rows[0].details).toEqual({ flag: 'look', from: 'rare', to: 'default', surface: 'web' })
    const { rows: others } = await db.pg.query('select ui_flags from users where id = $1', [normal.id])
    expect(others[0].ui_flags).toEqual({})
  })

  it('answers 400 for an unknown flag or value and writes nothing', async () => {
    for (const body of [{ name: 'neon', value: 'rare' }, { name: 'look', value: 'neon' }, { value: 'rare' }, {}]) {
      expect((await web('POST', adminCookie, body)).status, JSON.stringify(body)).toBe(400)
    }
    expect(await auditRows()).toHaveLength(1)
  })
})

describe('the admin over MCP', () => {
  it('lists and sets through the two tools, each running its own route', async () => {
    const caller = await mcpCaller()
    const tool = (name) => ADMIN_TOOLS.find((t) => t.name === name)
    const rest = (name) => (method, path, body) =>
      runAs({ ...caller, adminTool: name }, () =>
        route(new Request(`${APP_URL}/api${path}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }))
      )
    const set = await tool('admin_set_flag').run({ flag: 'components', value: 'default' }, { rest: rest('admin_set_flag') })
    expect(set.status).toBe(200)
    const list = await tool('admin_list_flags').run({}, { rest: rest('admin_list_flags') })
    const { flags } = JSON.parse(await list.text())
    expect(flags.find((f) => f.name === 'components').value).toBe('default')
    expect((await auditRows()).at(-1).details).toEqual({ flag: 'components', from: 'rare', to: 'default', surface: 'mcp' })
    // The wrong tool, a plain MCP caller and a bad argument are refused.
    expect((await rest('admin_stats')('GET', '/admin/flags')).status).toBe(404)
    expect((await runAs({ ...caller, admin: false, adminTool: undefined }, () => route(new Request(`${APP_URL}/api/admin/flags`)))).status).toBe(404)
    expect((await tool('admin_set_flag').run({ flag: 'look' }, { rest: rest('admin_set_flag') })).status).toBe(400)
  })
})
