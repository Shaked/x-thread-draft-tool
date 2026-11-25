// @vitest-environment node
// #405 (B1 a): an assistant reads a draft with get_draft, then edits it. The edit's result must show the draft as
// saved after the edit (the new text and version), never the state get_draft showed before it.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { route } from '../../server/router.js'
import { issuePair } from '../../server/oauth/tokens.js'
import { uiResourceUri } from '../../server/mcp/ui/index.js'
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
    expect(JSON.stringify(edited)).not.toContain('old post 2')
    expect(edited.content.at(-1).text).toContain(`Saved: version ${read.structuredContent.draft.version + 1}, 6 posts.`)
  })

  it('a refused stale edit says so in text, with no view data', async () => {
    await call('update_post', { id: db.draft.id, post_id: 'p2', text: 'first edit', version: 1 })
    const stale = await call('update_post', { id: db.draft.id, post_id: 'p3', text: 'second edit', version: 1 })
    expect(stale.isError).toBe(true)
    expect(stale._meta).toBeUndefined()
    expect(stale.content).toHaveLength(1)
    expect(stale.content[0].text).toContain('Nothing was written. Call get_draft to read it again')
  })
})
