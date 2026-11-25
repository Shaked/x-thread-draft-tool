// @vitest-environment node
// #405 (B1 a): an assistant reads a draft with get_draft, then edits it. The edit's result must show the draft as
// saved after the edit (the new text and version), never the state get_draft showed before it.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { route } from '../../server/router.js'
import { issuePair } from '../../server/oauth/tokens.js'
import { uiResourceUri } from '../../server/mcp/ui/index.js'
import { changeMeta } from '../../server/mcp/edit-result.js'
import { changesOf } from '../../src/utils/draftChanges.js'
import { APP_URL, setupTestDb } from './helpers/db.js'

const MCP = `${APP_URL}/api/mcp`
const EDIT_TOOLS = ['update_draft', 'add_post', 'update_post', 'remove_post', 'move_post', 'remove_image', 'add_image_from_url']
let db
let token

beforeAll(async () => {
  db = await setupTestDb()
})

beforeEach(async () => {
  await db.reset()
  await db.pg.query("insert into oauth_clients (client_id, kind, client_name) values ('xtc_mcp_test', 'registered', 'Test') on conflict do nothing")
  const alice = await db.insertUser({ github_id: 1, login: 'alice' })
  const { rows } = await db.pg.query(
    "insert into oauth_grants (user_id, client_id, scope, resource) values ($1, 'xtc_mcp_test', 'drafts', $2) returning id",
    [alice.id, MCP]
  )
  token = (await issuePair(rows[0].id)).access_token
  const posts = [1, 2, 3, 4, 5, 6].map((n) => ({ id: `p${n}`, text: `old post ${n}`, images: [], embeddedTweet: null }))
  db.draft = await db.insertDraft(alice.id, { title: 'Six', posts })
})

async function rpc(method, params) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: `Bearer ${token}` }
  const res = await route(new Request(MCP, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }))
  return (await res.json()).result
}
const call = (name, args) => rpc('tools/call', { name, arguments: args })

describe('#405: get_draft, then update_post', () => {
  it('every edit tool shows the thread view', async () => {
    const { tools } = await rpc('tools/list', {})
    const uri = uiResourceUri('thread')
    for (const name of EDIT_TOOLS) expect(tools.find((tool) => tool.name === name)._meta?.['openai/outputTemplate'], name).toBe(uri)
  })

  it('the edit result carries the new text and version for the view, and no text from before the edit', async () => {
    const read = await call('get_draft', { id: db.draft.id })
    const edited = await call('update_post', { id: db.draft.id, post_id: 'p2', text: 'new post 2', version: read.structuredContent.draft.version })
    expect(edited.isError).toBe(false)
    expect(edited._meta['x-thread/posts'].map((post) => post.text)).toEqual(['old post 1', 'new post 2', 'old post 3', 'old post 4', 'old post 5', 'old post 6'])
    expect(edited._meta['x-thread/outline'].version).toBe(read.structuredContent.draft.version + 1)
    // #405 (b): the view's posts hold no text from before the edit; the changes hold the one changed post, before and after.
    expect(JSON.stringify(edited._meta['x-thread/posts'])).not.toContain('old post 2')
    expect(edited._meta['x-thread/changes']).toMatchObject({ version: 2, post_count: 6, known: true, full: false })
    expect(edited._meta['x-thread/changes'].posts).toEqual([{ id: 'p2', status: 'edited', index: 2, before: 'old post 2', after: 'new post 2' }])
    // The text: only the changed post as it is now, never the rest of the draft (the view has the text before).
    const text = edited.content.slice(1).map((part) => part.text).join('\n')
    expect(text).toMatch(/^Saved\. Do not show the whole draft again: .* Version 2, 6 posts; changed: 1 post\. The view shows what changed\./)
    expect(text).toContain('**Post 2/6**, edited\n> new post 2')
    expect(text).not.toMatch(/old post/)
    // A replay (the same text again) writes nothing: one short line, not the whole draft.
    const replay = await call('update_post', { id: db.draft.id, post_id: 'p2', text: 'new post 2' })
    expect(replay.content.slice(1).map((part) => part.text)).toEqual(['Nothing changed. Version 2, 6 posts.'])
  })

  it('routing: most posts changed, or fewer than 4 posts, shows the whole draft; a move lists only the moved post', async () => {
    const posts = (await call('get_draft', { id: db.draft.id })).structuredContent.draft.posts
    const moved = await call('move_post', { id: db.draft.id, post_id: 'p6', position: 1 })
    expect(moved._meta['x-thread/changes'].posts).toEqual([{ id: 'p6', status: 'moved', index: 1, from: 6, before: 'old post 6', after: 'old post 6' }])
    const rewritten = await call('update_draft', { id: db.draft.id, posts: posts.map((post) => ({ ...post, text: `new ${post.text}` })) })
    expect(rewritten._meta['x-thread/changes']).toMatchObject({ known: true, full: true })
    expect(rewritten.content.at(-1).text).toMatch(/^Thread "Six", 6 posts, saved as a draft\./)
    await call('remove_post', { id: db.draft.id, post_id: 'p1' })
    await call('remove_post', { id: db.draft.id, post_id: 'p2' })
    const small = await call('update_post', { id: db.draft.id, post_id: 'p3', text: 'three' })
    expect(small._meta['x-thread/changes']).toMatchObject({ post_count: 4, full: false })
    const three = await call('remove_post', { id: db.draft.id, post_id: 'p4' })
    expect(three._meta['x-thread/changes']).toMatchObject({ post_count: 3, full: true })
  })

  it('a post with no id is not shown as removed; a repeated id shows the whole draft (Opus and Codex review on PR 422)', async () => {
    const posts = [{ text: 'no id' }, { id: 'd', text: 'd' }, { id: 'e', text: 'e' }, { id: 'f', text: 'f' }]
    await db.pg.query('update drafts set posts = $2::jsonb where id = $1', [db.draft.id, JSON.stringify(posts)])
    const added = await call('add_post', { id: db.draft.id, text: 'new', post_id: 'n' })
    expect(added._meta['x-thread/changes']).toMatchObject({ full: false, posts: [{ status: 'added', id: 'n' }] })
    // 5 posts, so 4 remain: only the repeated id makes it show the whole draft (not the under-4-posts rule).
    const twice = ['d', 'd', 'e', 'f', 'g'].map((id, i) => ({ id, text: `${id} ${i}` }))
    await db.pg.query('update drafts set posts = $2::jsonb where id = $1', [db.draft.id, JSON.stringify(twice)])
    const removed = await call('remove_post', { id: db.draft.id, post_id: 'd' })
    expect(removed._meta['x-thread/changes']).toMatchObject({ known: true, full: true, post_count: 4 })
    expect(removed.content.at(-1).text).toMatch(/^Thread "Six", 4 posts, saved as a draft\./)
    const one = (ids) => ({ version: 1, posts: ids.map((id) => ({ id, text: id })) })
    expect(changeMeta(one(['a', 'b', 'c', 'd', 'e']), { ...one(['a', 'b', 'c', 'd', 'x']), version: 2 })).toMatchObject({ full: false })
    expect(changeMeta(one(['a', 'a', 'c', 'd', 'e']), { ...one(['a', 'a', 'c', 'd', 'x']), version: 2 })).toMatchObject({ full: true })
  })

  it('another write between the read and this one: the state before is not known, so the whole draft is shown', () => {
    const before = { title: 'T', version: 3, posts: [{ id: 'a', text: 'x' }] }
    expect(changeMeta(before, { ...before, version: 5 })).toMatchObject({ known: false, full: true, posts: [] })
    expect(changeMeta(null, before)).toMatchObject({ known: false, full: true })
  })

  it('a long draft with one post moved lists that post only, in bounded memory (Codex review on PR 422)', () => {
    const posts = Array.from({ length: 8000 }, (_, i) => ({ id: `p${i}`, text: `${i}` }))
    const { posts: changed } = changesOf({ posts }, { posts: [...posts.slice(1), posts[0]] })
    expect(changed.map((c) => [c.status, c.id, c.index, c.from])).toEqual([['moved', 'p0', 8000, 1]])
  })

  it('a refused stale edit says so in text, with no view data', async () => {
    await call('update_post', { id: db.draft.id, post_id: 'p2', text: 'first edit', version: 1 })
    const stale = await call('update_post', { id: db.draft.id, post_id: 'p3', text: 'second edit', version: 1 })
    expect(stale.isError).toBe(true)
    expect(stale._meta).toBeUndefined()
    expect(stale.content).toHaveLength(1)
    expect(stale.content[0].text).toContain('Nothing was saved: the draft changed since you read it. Call get_draft_outline once')
  })
})
