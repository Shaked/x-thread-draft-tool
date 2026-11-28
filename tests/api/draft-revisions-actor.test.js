// @vitest-environment node
// E273 task H3 (#376): every write of a draft names its actor in the history. One seeded beforeAll; each test
// makes its own draft and reads the newest revision. All text is fake.
import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({
  putBlob: vi.fn(async (pathname) => ({ url: `https://store.public.blob.vercel-storage.com/${pathname}` })),
  deleteBlobUrls: vi.fn(async () => {})
}))

import { route } from '../../server/router.js'
import { issuePair } from '../../server/oauth/tokens.js'
import { createApiToken } from '../../server/tokens.js'
import { actorOf, FIXED_ACTOR_NAMES } from '../../server/revision-actor.js'
import { IMPORT_DRAFT_SQL } from '../../scripts/migrate-from-supabase.mjs'
import { APP_URL, apiRequest, setupTestDb } from './helpers/db.js'
import { makePng } from './helpers/images.js'

const MCP = `${APP_URL}/api/mcp`
const CLIENT = 'xtc_actor_test'
let db
let alice
let cookie
let apiToken
let restToken // OAuth access token for the REST API (resource <origin>/api)
let mcpToken // OAuth access token for the MCP endpoint
let id = 0

beforeAll(async () => {
  db = await setupTestDb()
  alice = await db.insertUser({ github_id: 1, login: 'alice' })
  cookie = await db.cookieFor(alice)
  await db.pg.query(`insert into oauth_clients (client_id, kind, client_name) values ($1, 'registered', 'Claude Desktop') on conflict do nothing`, [CLIENT])
  const grant = async (resource) =>
    (await db.pg.query(`insert into oauth_grants (user_id, client_id, scope, resource) values ($1, $2, 'drafts', $3) returning id`, [alice.id, CLIENT, resource])).rows[0].id
  restToken = (await issuePair(await grant(`${APP_URL}/api`))).access_token
  mcpToken = (await issuePair(await grant(MCP))).access_token
  apiToken = (await createApiToken(alice.id, { name: 'laptop' })).token
})

/** The newest revision of a draft: who wrote it and its label. */
const last = async (draftId) =>
  (await db.pg.query('select actor_kind, actor_name, label from draft_revisions where draft_id = $1 order by seq desc limit 1', [draftId])).rows[0]

const sessionDraft = async () => {
  const res = await route(apiRequest('/api/drafts', { method: 'POST', cookie, body: { title: 'T' } }))
  expect(res.status).toBe(201)
  return (await res.json()).draft
}

async function mcpTool(name, args) {
  id += 1
  const body = { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: `Bearer ${mcpToken}` }
  const { result } = await (await route(new Request(MCP, { method: 'POST', headers, body: JSON.stringify(body) }))).json()
  return { error: result.isError ? result.content[0].text : null }
}

describe('actorOf', () => {
  it('maps each caller kind', () => {
    expect(actorOf({ via: 'session' })).toEqual({ kind: 'user', name: 'Editor' })
    expect(actorOf({ via: 'oauth', clientName: 'Claude Desktop' })).toEqual({ kind: 'app', name: 'Claude Desktop' })
    expect(actorOf({ via: 'token' })).toEqual({ kind: 'app', name: 'API token' })
    expect(actorOf({ via: 'ci-oidc' })).toEqual({ kind: 'system', name: 'CI' })
    expect(actorOf({ uploadLink: true, uid: 1 })).toEqual({ kind: 'app', name: 'Upload link' })
  })

  it('never lets a client take a reserved name, and cuts the name to 60 characters', () => {
    for (const name of FIXED_ACTOR_NAMES) expect(actorOf({ via: 'oauth', clientName: name.toUpperCase() })).toEqual({ kind: 'app', name: 'App' })
    expect(actorOf({ via: 'oauth', clientName: '   ' }).name).toBe('App')
    expect(actorOf({ via: 'oauth', clientName: undefined }).name).toBe('App')
    expect(actorOf({ via: 'oauth', clientName: `Tool‮ ${'x'.repeat(80)}` }).name).toHaveLength(60)
    expect(actorOf({ via: 'oauth', clientName: 'A\u0007b' }).name).toBe('Ab')
  })

  it('folds look-alike names onto the reserved names, and keeps the rest as cleaned', () => {
    const cases = {
      'Upload\u00a0link': 'App', // no-break space
      'Upl\u00adoad link': 'App', // soft hyphen
      'Editor\u{e0041}': 'App', // tag character
      'Edi\u3164tor': 'App', // Hangul filler
      '\uff25\uff44\uff49\uff54\uff4f\uff52': 'App', // fullwidth Editor
      '\u0415ditor': 'App', // Cyrillic capital IE, mixed with Latin
      'Import\u0301': 'App', // combining accent
      'E\u0301ditor': 'App', // E with a combining accent: NFKC would compose it into a precomposed letter
      '\u00c9ditor': 'App', // the precomposed accented letter
      'Ed\u0131tor': 'App', // dotless i reads as i
      '\u0421\u0406': 'App', // Cyrillic С and І, all Cyrillic, read as CI
      '\u0441\u0456': 'App', // the same in lowercase
      '\u0410\u0440\u0440': 'App', // Cyrillic Арр reads as App
      '\u13df\u13c6': 'App', // Cherokee letters that read as CI
      '\u1d04\u026a': 'App', // small capitals c and i
      'Upl\u0585ad link': 'App', // Armenian small oh
      '\u0301': 'App', // only a combining mark: nothing to compare
      'Claude\u00adDesktop': 'ClaudeDesktop', // a hidden character inside a name is removed
      'Claude\u3164': 'Claude', // Hangul filler at the end
      '\u0420\u0435\u0434\u0430\u043a\u0442\u043e\u0440': '\u0420\u0435\u0434\u0430\u043a\u0442\u043e\u0440', // Russian word: kept
      '\u0395\u03c1\u03b3\u03b1\u03bb\u03b5\u03af\u03bf': '\u0395\u03c1\u03b3\u03b1\u03bb\u03b5\u03af\u03bf', // Greek word: kept
      '\u05e2\u05d5\u05d6\u05e8': '\u05e2\u05d5\u05d6\u05e8', // Hebrew word: kept
      'Editor\u200b': 'App', // zero-width space
      'Claude\u3000': 'Claude', // trailing ideographic space
      'Claude\u2028Desktop': 'Claude Desktop', // line separator
      '\u00a0Claude Desktop': 'Claude Desktop' // leading no-break space
    }
    for (const [clientName, name] of Object.entries(cases)) expect(actorOf({ via: 'oauth', clientName }).name).toBe(name)
  })

  it('throws for a caller it does not know, so no write goes out unnamed', () => {
    expect(() => actorOf({ via: 'web' })).toThrow('draft write without a known caller')
    expect(() => actorOf(null)).toThrow()
  })
})

describe('each draft write names its actor', () => {
  it('POST /api/drafts as the browser session', async () => {
    const draft = await sessionDraft()
    expect(await last(draft.id)).toEqual({ actor_kind: 'user', actor_name: 'Editor', label: null })
  })

  it('POST /api/drafts with a personal API token', async () => {
    const res = await route(apiRequest('/api/drafts', { method: 'POST', headers: { authorization: `Bearer ${apiToken}` }, body: { title: 'T' } }))
    expect(res.status).toBe(201)
    expect(await last((await res.json()).draft.id)).toEqual({ actor_kind: 'app', actor_name: 'API token', label: null })
  })

  it('POST /api/drafts with an OAuth token names the client, not the token', async () => {
    const res = await route(apiRequest('/api/drafts', { method: 'POST', headers: { authorization: `Bearer ${restToken}` }, body: { title: 'T' } }))
    expect(res.status).toBe(201)
    expect(await last((await res.json()).draft.id)).toEqual({ actor_kind: 'app', actor_name: 'Claude Desktop', label: null })
  })

  it('create_draft through MCP names the OAuth client', async () => {
    const title = `via mcp ${randomUUID()}`
    expect((await mcpTool('create_draft', { title })).error).toBeNull()
    const { rows } = await db.pg.query('select id from drafts where title = $1', [title])
    expect(rows).toHaveLength(1)
    expect(await last(rows[0].id)).toEqual({ actor_kind: 'app', actor_name: 'Claude Desktop', label: null })
  })

  it('PATCH /api/drafts/:id (title) as the session', async () => {
    const draft = await sessionDraft()
    const res = await route(apiRequest(`/api/drafts/${draft.id}`, { method: 'PATCH', cookie, body: { title: 'Renamed' } }))
    expect(res.status).toBe(200)
    expect(await last(draft.id)).toEqual({ actor_kind: 'user', actor_name: 'Editor', label: null })
  })

  it('PATCH /api/drafts/:id/posts/:postId (text) as the session', async () => {
    const draft = await sessionDraft()
    const res = await route(apiRequest(`/api/drafts/${draft.id}/posts/${draft.posts[0].id}`, { method: 'PATCH', cookie, body: { text: 'two' } }))
    expect(res.status).toBe(200)
    expect(await last(draft.id)).toEqual({ actor_kind: 'user', actor_name: 'Editor', label: null })
  })

  it('POST /api/drafts/:id/posts (add a post) as the session', async () => {
    const draft = await sessionDraft()
    const res = await route(apiRequest(`/api/drafts/${draft.id}/posts`, { method: 'POST', cookie, body: { text: 'three' } }))
    expect(res.status).toBe(200)
    expect(await last(draft.id)).toEqual({ actor_kind: 'user', actor_name: 'Editor', label: null })
  })

  it('POST /api/drafts/:id/duplicate labels the copy', async () => {
    const draft = await sessionDraft()
    const res = await route(apiRequest(`/api/drafts/${draft.id}/duplicate`, { method: 'POST', cookie, body: {} }))
    expect(res.status).toBe(201)
    expect(await last((await res.json()).draft.id)).toEqual({ actor_kind: 'user', actor_name: 'Editor', label: 'Copied from another draft' })
  })

  it('POST /api/drafts/:id/publish labels the publish when it clears images', async () => {
    const draft = await db.insertDraft(alice.id, {
      posts: [{ id: 'p1', text: 'hello', images: [{ url: 'https://store.public.blob.vercel-storage.com/a.png' }], embeddedTweet: null }]
    })
    const res = await route(apiRequest(`/api/drafts/${draft.id}/publish`, { method: 'POST', cookie, body: {} }))
    expect(res.status).toBe(200)
    expect(await last(draft.id)).toEqual({ actor_kind: 'user', actor_name: 'Editor', label: 'Published' })
  })

  it('a write over OAuth and a session edit right after it are two revisions', async () => {
    const draft = await sessionDraft()
    const postId = draft.posts[0].id
    const app = await route(apiRequest(`/api/drafts/${draft.id}/posts/${postId}`, { method: 'PATCH', headers: { authorization: `Bearer ${restToken}` }, body: { text: 'from app' } }))
    expect(app.status).toBe(200)
    expect(await last(draft.id)).toEqual({ actor_kind: 'app', actor_name: 'Claude Desktop', label: null })
    const own = await route(apiRequest(`/api/drafts/${draft.id}/posts/${postId}`, { method: 'PATCH', cookie, body: { text: 'from me' } }))
    expect(own.status).toBe(200)
    expect(await last(draft.id)).toEqual({ actor_kind: 'user', actor_name: 'Editor', label: null })
    const { rows } = await db.pg.query('select count(*)::int as n from draft_revisions where draft_id = $1 and seq > 0', [draft.id])
    expect(rows[0].n).toBeGreaterThanOrEqual(3)
  })

  it('a one-time upload link names itself as Upload link', async () => {
    const draft = await db.insertDraft(alice.id)
    const made = await route(apiRequest(`/api/drafts/${draft.id}/posts/p1/upload-links`, { method: 'POST', cookie, body: {} }))
    expect(made.status).toBe(201)
    const token = (await made.json()).url.split('#')[1]
    const up = await route(apiRequest('/api/upload-links/images', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: makePng() }))
    expect(up.status).toBe(201)
    expect(await last(draft.id)).toEqual({ actor_kind: 'app', actor_name: 'Upload link', label: null })
  })
})

describe('the Supabase import names itself as Import', () => {
  const row = (id, posts) => [id, alice.id, 'Old', JSON.stringify(posts), false, null, '2026-01-01', '2026-01-02']
  const stored = [{ id: 'p1', text: 'x', images: [{ url: 'https://x.supabase.co/storage/v1/object/public/draft-images/a.png' }], embeddedTweet: null }]
  const plain = [{ id: 'p1', text: 'x', images: [], embeddedTweet: null }]

  it('names an inserted draft system, Import', async () => {
    const id = randomUUID()
    await db.pg.query(IMPORT_DRAFT_SQL, row(id, plain))
    expect(await last(id)).toEqual({ actor_kind: 'system', actor_name: 'Import', label: null })
  })

  it('names a draft it rewrites, and leaves a draft it does not rewrite unchanged', async () => {
    const id = randomUUID()
    await db.pg.query(IMPORT_DRAFT_SQL, row(id, stored))
    const before = await last(id)
    const { affectedRows } = await db.pg.query(IMPORT_DRAFT_SQL, row(id, plain))
    expect(affectedRows).toBe(1)
    expect(await last(id)).toEqual({ actor_kind: 'system', actor_name: 'Import', label: null })
    expect(before).toEqual({ actor_kind: 'system', actor_name: 'Import', label: null })

    const keep = randomUUID()
    await db.pg.query(IMPORT_DRAFT_SQL, row(keep, plain))
    const { affectedRows: none } = await db.pg.query(IMPORT_DRAFT_SQL, row(keep, stored))
    expect(none).toBe(0)
  })
})

describe('three writers in a row', () => {
  it('an edit, an upload through the link and an edit again are three revisions, and the row keeps no actor', async () => {
    const draft = await db.insertDraft(alice.id)
    const edit = (text) => route(apiRequest(`/api/drafts/${draft.id}/posts/p1`, { method: 'PATCH', cookie, body: { text } }))
    expect((await edit('first')).status).toBe(200)
    const made = await route(apiRequest(`/api/drafts/${draft.id}/posts/p1/upload-links`, { method: 'POST', cookie, body: {} }))
    const token = (await made.json()).url.split('#')[1]
    expect((await route(apiRequest('/api/upload-links/images', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: makePng() }))).status).toBe(201)
    expect((await edit('second')).status).toBe(200)
    const { rows } = await db.pg.query('select actor_name from draft_revisions where draft_id = $1 order by seq desc limit 3', [draft.id])
    expect(rows.map((row) => row.actor_name)).toEqual(['Editor', 'Upload link', 'Editor'])
    const { rows: now } = await db.pg.query('select last_actor_kind, last_actor_name, last_label from drafts where id = $1', [draft.id])
    expect(now[0]).toEqual({ last_actor_kind: null, last_actor_name: null, last_label: null })
  })
})

describe('the import keeps updated_at and a re-run writes nothing', () => {
  it('leaves the imported updated_at on the conflict update, and a second run adds no revision', async () => {
    const id = randomUUID()
    const posts = [{ id: 'p1', text: 'x', images: [{ url: 'https://x.supabase.co/storage/v1/object/public/draft-images/a.png' }], embeddedTweet: null }]
    const plain = [{ id: 'p1', text: 'y', images: [], embeddedTweet: null }]
    const count = async () => (await db.pg.query('select count(*)::int as n from draft_revisions where draft_id = $1', [id])).rows[0].n
    const day = async () => (await db.pg.query("select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD') as d from drafts where id = $1", [id])).rows[0].d
    await db.pg.query(IMPORT_DRAFT_SQL, [id, alice.id, 'Old', JSON.stringify(posts), false, null, '2026-01-01', '2026-01-02'])
    expect(await day()).toBe('2026-01-02')
    const first = await db.pg.query(IMPORT_DRAFT_SQL, [id, alice.id, 'Old', JSON.stringify(plain), false, null, '2026-01-01', '2026-03-03'])
    expect(first.affectedRows).toBe(1)
    expect(await day()).toBe('2026-01-02')
    const afterFirst = await count()
    const again = await db.pg.query(IMPORT_DRAFT_SQL, [id, alice.id, 'Old', JSON.stringify(plain), false, null, '2026-01-01', '2026-03-03'])
    expect(again.affectedRows).toBe(0)
    expect(await count()).toBe(afterFirst)
  })
})
