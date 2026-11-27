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
