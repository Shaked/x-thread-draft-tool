// @vitest-environment node
// #485 (A3 of the admin hub #482): one access test for the whole admin area. The list is built from code: every REST
// route under /admin, every adminOnly route, every /ops route, every admin MCP tool and every admin page. Each row is
// checked as signed out, as a normal user and as the admin. The test fails when a new one has no row below.
// No person, no network: PGlite, in-process requests, the built dist/ as text.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({
  putBlob: vi.fn(),
  deleteBlobUrls: vi.fn(async () => {}),
  listBlobPrefix: vi.fn(async () => ({ files: [], truncated: false }))
}))

import { ROUTES, route } from '../../server/router.js'
import { issuePair } from '../../server/oauth/tokens.js'
import { ADMIN_TOOLS } from '../../server/mcp/admin-tools.js'
import { listTools } from '../../server/mcp/tools.js'
import { openapiDocument } from '../../server/routes/openapi.js'
import { adminPages, readSrc } from '../helpers/admin-pages.js'
import { apiRequest, setupTestDb, APP_URL } from './helpers/db.js'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const API = `${APP_URL}/api`
const MCP = `${API}/mcp`
const NIL = '00000000-0000-4000-8000-000000000000'
const HEADER = { 'x-xt-admin': '1' }
const LEGACY = '2025-11-25'

// ---- The rows. A new admin route, tool or page without a row here fails "has a row for every ..." below. ----
// REST: "METHOD router-path" -> the request to send, and what the admin gets. `same`: the admin gets the unknown-path answer too
// (the /ops routes open only for the metrics-daily workflow's CI token, never for a person).
const REST_ROWS = {
  'GET /admin/status': { url: '/admin/status' },
  'GET /admin/users': { url: '/admin/users' },
  'GET /admin/users/:id': { url: `/admin/users/${NIL}`, adminNot: 'Not found' },
  'GET /admin/stats': { url: '/admin/stats' },
  'GET /admin/audit': { url: '/admin/audit' },
  'GET /admin/metrics': { url: '/admin/metrics' },
  'GET /admin/metrics/series': { url: '/admin/metrics/series?name=requests' },
  'GET /admin/flags': { url: '/admin/flags' },
  'POST /admin/flags': { url: '/admin/flags', body: {} },
  'POST /admin/users/:id/suspend': { url: `/admin/users/${NIL}/suspend`, body: {} },
  'POST /admin/users/:id/unsuspend': { url: `/admin/users/${NIL}/unsuspend`, body: {} },
  'POST /admin/users/:id/delete': { url: `/admin/users/${NIL}/delete`, body: {} },
  'GET /changelog': { url: '/changelog' },
  'POST /ops/events': { url: '/ops/events', body: {}, adminSame: true },
  'POST /ops/metrics-daily': { url: '/ops/metrics-daily', body: {}, adminSame: true }
}

// MCP: admin tool -> harmless arguments (reads, or writes that the handler refuses or that touch only the admin's own view).
const MCP_ROWS = {
  admin_status: {},
  admin_list_users: {},
  admin_get_user: { id: NIL },
  admin_stats: {},
  admin_audit_log: {},
  admin_metrics: {},
  admin_metrics_series: { name: 'requests' },
  admin_list_flags: {},
  admin_set_flag: { flag: 'look', value: 'default' },
  admin_suspend_user: { id: NIL, confirm_login: 'nobody' },
  admin_unsuspend_user: { id: NIL, confirm_login: 'nobody' },
  admin_delete_user: { id: NIL, confirm_login: 'nobody' }
}

const isAdminRoute = (r) => r.path === '/admin' || r.path.startsWith('/admin/') || r.adminOnly === true || r.path.startsWith('/ops/')
const adminRoutes = ROUTES.filter(isAdminRoute)
const pages = adminPages()

const table = []
const note = (kind, name, signedOut, normal, admin) => table.push({ kind, name, signedOut, normal, admin })

let db
let normalCookie
let adminCookie
let normalToken
let adminToken

async function grantToken(user, label) {
  const client = `xtc_admin_access_${label}`
  await db.pg.query("insert into oauth_clients (client_id, kind, client_name) values ($1, 'registered', 'Access test')", [client])
  const { rows } = await db.pg.query(
    "insert into oauth_grants (user_id, client_id, scope, resource) values ($1, $2, 'drafts', $3) returning id",
    [user.id, client, MCP]
  )
  return (await issuePair(rows[0].id)).access_token
}

beforeAll(async () => {
  db = await setupTestDb()
  await db.reset()
  await db.pg.exec('delete from oauth_clients')
  const admin = await db.insertUser({ github_id: 960015, login: 'shaked' })
  const normal = await db.insertUser({ github_id: 1, login: 'alice' })
  adminCookie = await db.cookieFor(admin)
  normalCookie = await db.cookieFor(normal)
  adminToken = await grantToken(admin, 'admin')
  normalToken = await grantToken(normal, 'normal')
})

afterAll(() => {
  const width = (key) => Math.max(key.length, ...table.map((row) => String(row[key]).length))
  const cols = ['kind', 'name', 'signedOut', 'normal', 'admin']
  const widths = Object.fromEntries(cols.map((c) => [c, width(c)]))
  const line = (row) => cols.map((c) => String(row[c]).padEnd(widths[c])).join(' | ')
  console.log(`\nAdmin access table (#485)\n${line(Object.fromEntries(cols.map((c) => [c, c])))}\n${table.map(line).join('\n')}\n`)
})

// ---- The list is built from code, and every entry has a row ----
describe('the access table has a row for every admin route, tool and page', () => {
  it('has a row for every admin REST route (the /admin routes, adminOnly routes and /ops routes)', () => {
    const fromCode = adminRoutes.map((r) => `${r.method} ${r.path}`).sort()
    expect(fromCode.length).toBeGreaterThan(10)
    expect(Object.keys(REST_ROWS).sort()).toEqual(fromCode)
  })

  it('has a row for every admin MCP tool, and no normal tool is an admin tool', () => {
    expect(Object.keys(MCP_ROWS).sort()).toEqual(ADMIN_TOOLS.map((t) => t.name).sort())
    const normalNames = listTools(null, APP_URL).map((t) => t.name)
    expect(normalNames.filter((name) => /admin/i.test(name))).toEqual([])
  })

  it('lists the admin pages from the source, and each is on the table below', () => {
    expect(pages).toEqual(['/admin', '/admin/audit', '/admin/changelog', '/admin/flags', '/admin/metrics', '/admin/users', '/admin/users/:id', '/changelog'])
    // The jsdom test tests/unit/admin-access-pages.test.jsx renders every one of these as signed out, normal user and admin.
    for (const page of pages) note('page', page, 'as unknown path', 'as unknown path', 'real page (tests/unit/admin-access-pages.test.jsx)')
  })
})

// ---- REST ----
const call = (method, url, { body, cookie, headers } = {}) => route(apiRequest(`/api${url}`, { method, body, cookie, headers }))

describe('REST: signed out and normal user get the unknown-path answer, the admin gets the real one', () => {
  for (const r of adminRoutes) {
    const key = `${r.method} ${r.path}`
    it(key, async () => {
      const row = REST_ROWS[key]
      expect(row, `no row for ${key}`).toBeDefined()
      const unknown = await call(r.method, '/zz-no-such-route', { body: row.body })
      const expected = { status: 404, text: await unknown.text() }
      expect(unknown.status).toBe(404)
      const answer = async (opts) => {
        const res = await call(r.method, row.url, { body: row.body, ...opts })
        return { status: res.status, text: await res.text() }
      }
      const out = await answer({})
      const user = await answer({ cookie: normalCookie, headers: HEADER })
      expect(out).toEqual(expected)
      expect(user).toEqual(expected)
      const admin = await answer({ cookie: adminCookie, headers: HEADER })
      if (row.adminSame) {
        expect(admin).toEqual(expected)
      } else if (row.adminNot) {
        expect(admin.text).not.toBe(expected.text)
      } else {
        expect(admin.status, `${key} as admin: ${admin.text}`).toBeLessThan(500)
        expect(admin.status === 404 && admin.text === expected.text, `${key} as admin looks like an unknown path`).toBe(false)
      }
      note('rest', key, out.status, user.status, row.adminSame ? `${admin.status} (CI token only)` : admin.status)
    })
  }
})

// ---- MCP ----
async function rpc(token, method, params = {}) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': LEGACY }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await route(new Request(MCP, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }))
  return { status: res.status, text: await res.text() }
}
const parsed = (res) => JSON.parse(res.text)

describe('MCP: the admin tools are listed and callable only for the admin', () => {
  for (const name of Object.keys(MCP_ROWS)) {
    it(name, async () => {
      const call = (token, tool) => rpc(token, 'tools/call', { name: tool, arguments: MCP_ROWS[name] })
      const swap = (res, tool) => res.text.replaceAll(tool, 'NAME')
      // Signed out and normal user: the same answer as for a tool name that does not exist.
      const outReal = await call(null, name)
      const outMade = await call(null, 'admin_zz_no_such_tool')
      expect(outReal.status).toBe(outMade.status)
      expect(swap(outReal, name)).toBe(swap(outMade, 'admin_zz_no_such_tool'))
      const userReal = await call(normalToken, name)
      const userMade = await call(normalToken, 'admin_zz_no_such_tool')
      expect(parsed(userReal).error.code).toBe(-32602)
      expect(swap(userReal, name)).toBe(swap(userMade, 'admin_zz_no_such_tool'))
      // The list: not in the normal user's, in the admin's.
      const userList = parsed(await rpc(normalToken, 'tools/list')).result.tools.map((t) => t.name)
      const adminList = parsed(await rpc(adminToken, 'tools/list')).result.tools.map((t) => t.name)
      expect(userList).not.toContain(name)
      expect(adminList).toContain(name)
      // The admin gets a tool result, not the unknown-tool error.
      const admin = parsed(await call(adminToken, name))
      expect(admin.error, `${name} as admin`).toBeUndefined()
      expect(Array.isArray(admin.result?.content)).toBe(true)
      note('mcp', name, `${outReal.status} like unknown`, 'unknown tool (-32602)', admin.result.isError ? 'tool result (refused args)' : 'tool result')
    })
  }

  it('app_version gives the changelog key only to the admin', async () => {
    const version = async (token) => parsed(await rpc(token, 'tools/call', { name: 'app_version', arguments: {} })).result.structuredContent
    expect(await version(normalToken)).not.toHaveProperty('changelog')
    expect(await version(adminToken)).toHaveProperty('changelog')
    note('mcp', 'app_version (changelog key)', 'n/a', 'key absent', 'key present')
  })
})

// ---- No admin text or data where a normal caller reads ----
const adminDescriptions = ADMIN_TOOLS.map((t) => t.description.slice(0, 40))

describe('admin text is not in anything a normal caller reads', () => {
  it('not in the normal MCP lists (tools, prompts, resources) and not in the server instructions', async () => {
    const parts = []
    for (const method of ['initialize', 'tools/list', 'prompts/list', 'resources/list']) parts.push((await rpc(normalToken, method, method === 'initialize' ? { protocolVersion: LEGACY, capabilities: {}, clientInfo: { name: 't', version: '1' } } : {})).text)
    const text = parts.join('\n')
    expect(text.length).toBeGreaterThan(1000)
    for (const name of Object.keys(MCP_ROWS)) expect(text, name).not.toContain(name)
    for (const piece of adminDescriptions) expect(text).not.toContain(piece)
    expect(text).not.toMatch(/\/admin\b|admin_/i)
    note('text', 'normal MCP lists', 'n/a', 'no admin text', 'n/a')
  })

  it('not in /api/openapi.json and not in public/llms.txt', async () => {
    const served = await (await openapiDocument()).text()
    const llms = readFileSync(join(ROOT, 'public/llms.txt'), 'utf8')
    // The /ops routes are documented on purpose (tests/api/openapi.test.js): only the CI token opens them. Admin paths are not.
    const paths = adminRoutes.filter((r) => !r.path.startsWith('/ops/')).map((r) => r.path)
    for (const [name, text] of [['openapi.json', served], ['llms.txt', llms]]) {
      expect(text, name).not.toMatch(/admin/i)
      for (const path of paths) expect(text, `${name} ${path}`).not.toContain(`"${path}"`)
      for (const piece of Object.keys(MCP_ROWS)) expect(text, `${name} ${piece}`).not.toContain(piece)
    }
    expect(llms).not.toContain('/api/changelog')
    note('text', '/api/openapi.json and llms.txt', 'n/a', 'no admin text', 'n/a')
  })
})

// ---- The normal JavaScript bundle (dist/ is built before the API tests in CI) ----
const ASSETS = join(ROOT, 'dist', 'assets')
const srcFiles = (dir) => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? srcFiles(`${dir}/${e.name}`) : /\.jsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []))

/** Long texts of the admin page sources (string literals and JSX text) that no other source file has. */
function adminTexts() {
  const adminFiles = [...srcFiles('src/pages/admin'), 'src/pages/ChangelogPage.jsx']
  const others = srcFiles('src').filter((f) => !adminFiles.includes(f)).map(readSrc).join('\n')
  const texts = new Set()
  for (const file of adminFiles) {
    const source = readSrc(file)
    for (const m of source.matchAll(/'([^'\n]{30,}?)'|"([^"\n]{30,}?)"|>\s*([A-Za-z][^<>{}\n]{29,}?)\s*</g)) {
      const text = (m[1] ?? m[2] ?? m[3]).trim()
      if (/^[A-Za-z]/.test(text) && text.includes(' ') && !/[\\$`]/.test(text) && !others.includes(text)) texts.add(text)
    }
  }
  return [...texts]
}

describe('admin text is not in the normal JavaScript bundle', () => {
  it('admin page texts and changelog entries appear only in the lazy admin chunk (assets/AdminLayout-*)', async () => {
    expect(existsSync(ASSETS), 'run npm run build first').toBe(true)
    const files = readdirSync(ASSETS).filter((n) => n.endsWith('.js')).map((name) => ({ name, text: readFileSync(join(ASSETS, name), 'utf8') }))
    const normal = files.filter((f) => !f.name.startsWith('AdminLayout-'))
    const admin = files.filter((f) => f.name.startsWith('AdminLayout-'))
    expect(admin.length).toBeGreaterThan(0)
    const texts = adminTexts()
    const inAdmin = texts.filter((t) => admin.some((f) => f.text.includes(t) || f.text.includes(JSON.stringify(t).slice(1, -1))))
    expect(inAdmin.length, 'the scan must find admin text in the admin chunk, or it proves nothing').toBeGreaterThan(5)
    const leaked = texts.filter((t) => normal.some((f) => f.text.includes(t) || f.text.includes(JSON.stringify(t).slice(1, -1))))
    expect(leaked).toEqual([])
    const entries = (await import('../../server/generated/changelog.js')).default
    const notes = entries.flatMap((e) => [e.summary, e.title]).filter((t) => typeof t === 'string' && t.length >= 40)
    expect(notes.length).toBeGreaterThan(0)
    expect(notes.filter((t) => normal.some((f) => f.text.includes(t) || f.text.includes(JSON.stringify(t).slice(1, -1)))).map((t) => t.slice(0, 60))).toEqual([])
    note('bundle', `${inAdmin.length} admin texts + ${notes.length} changelog notes`, 'n/a', 'not in normal chunks', 'only in AdminLayout-*')
  })
})
