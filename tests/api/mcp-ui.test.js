// @vitest-environment node
// Plan Task 1 (#170): the MCP views as ui:// resources. Lists and reads them on the MCP endpoint, checks the
// results against the vendored official schemas, and checks the view HTML for the rules that the plan states
// (no script or link from other hosts, one image host at most, small size, the same HTML for every user).
import { createHash } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Ajv2020 from 'ajv/dist/2020'
import officialApp from '@modelcontextprotocol/ext-apps/schema.json'

vi.mock('../../server/blob.js', () => ({ putBlob: vi.fn(), deleteBlobUrls: vi.fn(async () => {}) }))

import { route } from '../../server/router.js'
import { issuePair } from '../../server/oauth/tokens.js'
import { blobOrigin } from '../../server/mcp/ui/origin.js'
import { listUiResources, readUiResource, uiResourceUri } from '../../server/mcp/ui/index.js'
import { APP_URL, setupTestDb } from './helpers/db.js'
import { expectValid } from './helpers/mcp-schema.js'

const MCP = `${APP_URL}/api/mcp`
const MODERN = '2026-07-28'
const LEGACY = '2025-11-25'
const EARLIER = '2025-06-18' // no vendored schema for this revision: shape checks only
const MIME = 'text/html;profile=mcp-app'
const SKILL_URI = 'skill://x-thread-drafts/SKILL.md'
// The official app schema of @modelcontextprotocol/ext-apps (the version pinned in package.json) defines _meta.ui.
const appAjv = new Ajv2020({ strict: false, allErrors: true })
appAjv.addSchema(officialApp)
const validResourceMeta = appAjv.getSchema('https://modelcontextprotocol.io/ext-apps/schema.json#/$defs/McpUiResourceMeta')
const VIEW_URI = /^ui:\/\/x-thread\/(thread|drafts|share)\.html\?v=[0-9a-f]{12}$/

let db
let aliceToken
let bobToken

beforeAll(async () => {
  db = await setupTestDb()
})

beforeEach(async () => {
  await db.reset()
  await db.pg.query(
    "insert into oauth_clients (client_id, kind, client_name) values ('xtc_ui_test', 'registered', 'Test') on conflict do nothing"
  )
  for (const [login, github_id] of [['alice', 1], ['bob', 2]]) {
    const user = await db.insertUser({ github_id, login })
    const { rows } = await db.pg.query(
      "insert into oauth_grants (user_id, client_id, scope, resource) values ($1, 'xtc_ui_test', 'drafts', $2) returning id",
      [user.id, MCP]
    )
    const token = (await issuePair(rows[0].id)).access_token
    if (login === 'alice') aliceToken = token
    else bobToken = token
  }
})

function request(version, method, params = {}, { token = aliceToken, auth = true } = {}) {
  const h = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
  if (auth) h.authorization = `Bearer ${token}`
  let body
  if (version === MODERN) {
    h['mcp-protocol-version'] = MODERN
    h['mcp-method'] = method
    if (method === 'resources/read') h['mcp-name'] = params.uri
    if (method === 'tools/call') h['mcp-name'] = params.name
    body = { jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN } } }
  } else {
    h['mcp-protocol-version'] = version
    body = { jsonrpc: '2.0', id: 1, method, params }
  }
  return new Request(MCP, { method: 'POST', headers: h, body: JSON.stringify(body) })
}

async function rpc(version, method, params, opts) {
  const res = await route(request(version, method, params, opts))
  return { status: res.status, body: JSON.parse(await res.text()) }
}

describe.each([MODERN, LEGACY, EARLIER])('UI views, protocol %s', (version) => {
  it('resources/list has the skill and the thread view, with the MIME type and the CSP', async () => {
    const { body } = await rpc(version, 'resources/list')
    const uris = body.result.resources.map((r) => r.uri)
    expect(uris).toContain(SKILL_URI)
    const view = body.result.resources.find((r) => r.uri.startsWith('ui://'))
    expect(view).toMatchObject({ name: 'thread', mimeType: MIME })
    expect(view.uri).toMatch(VIEW_URI)
    expect(view._meta.ui.csp).toEqual({ connectDomains: [], resourceDomains: expectedImageHosts() })
    expect(view._meta.ui.prefersBorder).toBe(true)
    expect(view.size).toBeLessThan(32 * 1024)
    if (version !== EARLIER) expectValid(version, 'ListResourcesResult', body.result)
  })

  it('resources/read returns the view as one HTML document, valid against the official schema', async () => {
    const { body: list } = await rpc(version, 'resources/list')
    const uri = list.result.resources.find((r) => r.uri.startsWith('ui://')).uri
    const { body } = await rpc(version, 'resources/read', { uri })
    if (version !== EARLIER) expectValid(version, 'ReadResourceResult', body.result)
    expect(body.result.contents).toHaveLength(1)
    const [item] = body.result.contents
    expect(item).toMatchObject({ uri, mimeType: MIME })
    expect(item.text.startsWith('<!doctype html>')).toBe(true)
    expect(item._meta.ui).toEqual({ csp: { connectDomains: [], resourceDomains: expectedImageHosts() }, prefersBorder: true })
    // ChatGPT's widget keys (T10, #238): the same image host, in the snake_case form ChatGPT reads.
    expect(item._meta['openai/widgetCSP']).toEqual({ connect_domains: [], resource_domains: expectedImageHosts() })
    expect(item._meta['openai/widgetPrefersBorder']).toBe(true)
  })

  it('a wrong ?v= is not found', async () => {
    const bad = 'ui://x-thread/thread.html?v=000000000000'
    const { body } = await rpc(version, 'resources/read', { uri: bad })
    expect(body.error.code).toBe(version === MODERN ? -32602 : -32002)
  })

  it('an unsigned request is still 401', async () => {
    const res = await route(request(version, 'resources/list', {}, { auth: false }))
    expect(res.status).toBe(401)
  })
})

describe('the view HTML', () => {
  it('has no script or link from another host, no http URL, and no host other than the image host', () => {
    const [view] = readUiResourceForTest()
    const html = view.text
    expect(html).not.toMatch(/<script\s[^>]*src=/i)
    expect(html).not.toMatch(/<link/i)
    expect(html).not.toMatch(/http:\/\//i)
    const hosts = [...html.matchAll(/https:\/\/[^\s"'<>)]+/g)].map((m) => m[0])
    expect(hosts).toEqual([])
  })

  it('is under 32 KB and is the same for every user', async () => {
    const alice = await rpc(MODERN, 'resources/read', { uri: uiResourceUri('thread') })
    const bob = await rpc(MODERN, 'resources/read', { uri: uiResourceUri('thread') }, { token: bobToken })
    expect(Buffer.byteLength(alice.body.result.contents[0].text, 'utf8')).toBeLessThan(32 * 1024)
    expect(bob.body.result.contents[0].text).toBe(alice.body.result.contents[0].text)
  })
})

describe('the image host', () => {
  it('is the store host from the token, with the store id lowercased', () => {
    expect(blobOrigin({ BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_ABC123_secretpart' })).toBe(
      'https://abc123.public.blob.vercel-storage.com'
    )
  })

  it('is null when the token is missing, empty, malformed or has bad characters', () => {
    expect(blobOrigin({})).toBeNull()
    expect(blobOrigin({ BLOB_READ_WRITE_TOKEN: '' })).toBeNull()
    expect(blobOrigin({ BLOB_READ_WRITE_TOKEN: 'not-a-token' })).toBeNull()
    expect(blobOrigin({ BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_bad.id_secret' })).toBeNull()
  })

  it('never returns the secret part of the token', () => {
    const origin = blobOrigin({ BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_abc123_TOPSECRETVALUE' })
    expect(origin).not.toContain('TOPSECRETVALUE')
  })

  it('with a token, the CSP allows exactly the store host and no other', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_abc123_secretpart')
    try {
      vi.resetModules()
      const fresh = await import('../../server/mcp/ui/index.js')
      const [entry] = fresh.listUiResources()
      expect(entry._meta.ui.csp.resourceDomains).toEqual(['https://abc123.public.blob.vercel-storage.com'])
      const [content] = fresh.readUiResource(entry.uri)
      expect(content._meta.ui.csp.resourceDomains).toEqual(['https://abc123.public.blob.vercel-storage.com'])
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })
})

function readUiResourceForTest() {
  return readUiResource(uiResourceUri('thread'))
}

/** The image host this process was started with: one host from the token, or none. */
function expectedImageHosts() {
  const origin = blobOrigin(process.env)
  return origin ? [origin] : []
}

describe('the view metadata against the official app schema', () => {
  it('the share card declares clipboard write in its _meta.ui, and both copies are valid McpUiResourceMeta', () => {
    const uri = uiResourceUri('share')
    const [entry] = listUiResources().filter((e) => e.uri === uri)
    const [content] = readUiResource(uri)
    expect(entry._meta.ui.permissions).toEqual({ clipboardWrite: {} })
    expect(content._meta.ui.permissions).toEqual({ clipboardWrite: {} })
    for (const meta of [entry._meta.ui, content._meta.ui]) {
      expect(validResourceMeta(meta), JSON.stringify(validResourceMeta.errors)).toBe(true)
    }
  })

  it('_meta.ui of the list entry and of the read content is a valid McpUiResourceMeta', () => {
    const [entry] = listUiResources()
    const [content] = readUiResource(entry.uri)
    for (const meta of [entry._meta.ui, content._meta.ui]) {
      expect(validResourceMeta(meta), JSON.stringify(validResourceMeta.errors)).toBe(true)
    }
  })
})

describe('GET /api/mcp/ui-manifest (plan T2): hashes only, public, no-store', () => {
  const MANIFEST = `${APP_URL}/api/mcp/ui-manifest`
  const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex')

  it('answers without a token with no-store and one entry per view, with no HTML', async () => {
    const res = await route(new Request(MANIFEST))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json()
    expect(Object.keys(body).sort()).toEqual(['imageOrigin', 'views'])
    expect(body.imageOrigin).toBe(expectedImageHosts()[0] ?? null)
    expect(body.views.length).toBe(listUiResources().length)
    for (const view of body.views) {
      expect(Object.keys(view).sort()).toEqual(['mimeType', 'sha256', 'size', 'uri'])
      expect(view.uri).toMatch(VIEW_URI)
      expect(view.mimeType).toBe(MIME)
    }
    expect(JSON.stringify(body)).not.toContain('<')
  })

  it('each sha256 is the hash of the exact HTML the view resource serves', async () => {
    const res = await route(new Request(MANIFEST))
    const { views } = await res.json()
    for (const view of views) {
      const [content] = readUiResource(view.uri)
      expect(view.sha256).toBe(sha(content.text))
      expect(view.size).toBe(Buffer.byteLength(content.text, 'utf8'))
    }
  })

  it('answers the same to a signed-in user and to a stranger', async () => {
    const plain = await (await route(new Request(MANIFEST))).text()
    const signedIn = await (await route(new Request(MANIFEST, { headers: { authorization: `Bearer ${aliceToken}` } }))).text()
    expect(signedIn).toBe(plain)
  })
})

describe('the tools that show the thread view (plan Task 4, #177), the drafts list (Task 5, #182) and the share card (Task 6, #187)', () => {
  // Each view tool, with the view it shows: the thread view, the drafts list (list_drafts) or the share card.
  const VIEW_OF = {
    get_draft: 'thread',
    create_draft: 'thread',
    split_text: 'thread',
    create_thread_from_text: 'thread',
    list_drafts: 'drafts',
    create_share_link: 'share'
  }
  const call = async (name, args) => (await rpc(MODERN, 'tools/call', { name, arguments: args })).body.result

  it('tools/list gives each view tool its view uri in all three keys, and no other tool a view', async () => {
    const { body } = await rpc(MODERN, 'tools/list', {})
    for (const tool of body.result.tools) {
      if (VIEW_OF[tool.name]) {
        const uri = uiResourceUri(VIEW_OF[tool.name])
        expect(tool._meta, tool.name).toEqual({ ui: { resourceUri: uri }, 'ui/resourceUri': uri, 'openai/outputTemplate': uri })
      } else {
        expect(tool._meta).toBeUndefined()
      }
    }
    expect(body.result.tools.filter((tool) => tool._meta).map((tool) => tool.name).sort()).toEqual(Object.keys(VIEW_OF).sort())
  })

  it('list_drafts: the editor base is in _meta; content and structuredContent are the REST body, unchanged', async () => {
    await call('create_draft', { title: 'Listed', posts: [{ text: 'Hello' }] })
    const listed = await call('list_drafts', {})
    expect(listed.isError).not.toBe(true)
    expect(listed.content[0].text).toBe(JSON.stringify(listed.structuredContent))
    expect(listed.structuredContent.drafts.length).toBeGreaterThan(0)
    expect(listed._meta).toEqual({ 'x-thread/editorBase': `${APP_URL}/draft/` })
  })

  it('get_draft: the outline, the editor base and the image host are in _meta; content is the REST body, unchanged', async () => {
    const created = await call('create_draft', { title: 'Meta', posts: [{ text: 'Hello' }, { text: 'Second post' }] })
    const got = await call('get_draft', { id: created.structuredContent.draft.id })
    expect(got.isError).not.toBe(true)
    expect(got.content[0].text).toBe(JSON.stringify(got.structuredContent))
    expect(got._meta['x-thread/outline'].posts.map((post) => [post.index, post.chars])).toEqual([
      [1, 5],
      [2, 11]
    ])
    expect(got._meta['x-thread/editorBase']).toBe(`${APP_URL}/draft/`)
    expect(got._meta['x-thread/imageOrigin']).toBe(blobOrigin() ?? undefined)
  })

  it('create_draft and create_thread_from_text: _meta carries the same outline as structuredContent.draft', async () => {
    const made = await call('create_draft', { title: 'Two', posts: [{ text: 'One' }] })
    expect(made._meta['x-thread/outline']).toEqual(made.structuredContent.draft)
    const thread = await call('create_thread_from_text', { text: 'One. Two.' })
    expect(thread.isError).not.toBe(true)
    expect(thread._meta['x-thread/outline']).toEqual(thread.structuredContent.draft)
  })

  it('create_share_link: the share card is linked, and the result has no _meta (the two URLs are in structuredContent)', async () => {
    const created = await call('create_draft', { title: 'Share', posts: [{ text: 'Hello' }] })
    const link = await call('create_share_link', { id: created.structuredContent.draft.id })
    expect(link.isError).not.toBe(true)
    expect(link._meta).toBeUndefined()
    expect(link.structuredContent.preview_url).toContain(link.structuredContent.token)
    expect(link.structuredContent.markdown_url).toContain(link.structuredContent.token)
  })

  it('create tools: _meta has the full posts (text and images) in the same order; structuredContent has the outline only', async () => {
    const made = await call('create_draft', { title: 'Full', posts: [{ text: 'First' }, { text: 'Second' }] })
    expect(made.structuredContent.draft.posts[0]).not.toHaveProperty('text')
    expect(made._meta['x-thread/posts'].map((post) => post.text)).toEqual(['First', 'Second'])
    const thread = await call('create_thread_from_text', { text: 'Alpha. Beta.' })
    expect(thread._meta['x-thread/posts'].map((post) => post.text)).toEqual(thread.structuredContent.draft.posts.map(() => expect.any(String)))
  })

  it('split_text: no draft wrapper (the view shows it as not saved), and the outline counts its posts', async () => {
    const split = await call('split_text', { text: 'Short post.' })
    expect(split.structuredContent.draft).toBeUndefined()
    expect(split._meta['x-thread/outline'].posts.length).toBe(split.structuredContent.posts.length)
  })

  it('a failed call has no view keys in _meta', async () => {
    const res = await call('get_draft', { id: '00000000-0000-4000-8000-000000000000' })
    expect(res.isError).toBe(true)
    expect(res._meta).toBeUndefined()
  })
})
