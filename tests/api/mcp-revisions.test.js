// @vitest-environment node
// #380 (E273 task H7): list_revisions, get_revision and restore_revision, each as an OAuth caller. The text is readable
// (one line per revision, before and after as block quotes), never a code block; a stale version writes nothing;
// another user's draft is "Draft not found"; a view-as caller is refused.
import { beforeAll, describe, expect, it } from 'vitest'
import { route } from '../../server/router.js'
import { issuePair } from '../../server/oauth/tokens.js'
import { callTool } from '../../server/mcp/tools.js'
import { APP_URL, setupTestDb } from './helpers/db.js'

const MCP = `${APP_URL}/api/mcp`
const LONG = 'The original second post is written long enough that no outline preview of forty characters can hold all of it.'
const HE = 'פוסט שני בעברית, כמו שנכתב: "שלום" – עולם!'
let db
let alice
let bob
let aliceToken
let bobToken
let draft

// One seed for the file (a seed per test costs about 0.2 s on CI, and the shard budget is tight). Only the last test writes.
beforeAll(async () => {
  db = await setupTestDb()
  await db.reset()
  await db.pg.query("insert into oauth_clients (client_id, kind, client_name) values ('xtc_rev_test', 'registered', 'Test') on conflict do nothing")
  alice = await db.insertUser({ github_id: 1, login: 'alice' })
  bob = await db.insertUser({ github_id: 2, login: 'bob' })
  const tokenFor = async (user) => {
    const { rows } = await db.pg.query("insert into oauth_grants (user_id, client_id, scope, resource) values ($1, 'xtc_rev_test', 'drafts', $2) returning id", [user.id, MCP])
    return (await issuePair(rows[0].id)).access_token
  }
  aliceToken = await tokenFor(alice)
  bobToken = await tokenFor(bob)
  const post = (id, text) => ({ id, text, images: [], embeddedTweet: null })
  draft = await db.insertDraft(alice.id, { title: 'History', posts: [post('p1', 'first post'), post('p2', LONG)] })
  // Revision 2: an assistant rewrites post 2 (Hebrew) and adds post 3. An actor makes a revision of its own.
  await db.pg.query(
    "update drafts set posts = $2::jsonb, version = version + 1, last_actor_kind = 'assistant', last_actor_name = 'ChatGPT' where id = $1",
    [draft.id, JSON.stringify([post('p1', 'first post'), post('p2', HE), post('p3', 'third post')])]
  )
})

async function call(token, name, args) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: `Bearer ${token}` }
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }
  return (await (await route(new Request(MCP, { method: 'POST', headers, body: JSON.stringify(body) }))).json()).result
}
const textOf = (result) => result.content.map((part) => part.text).join('\n')
const current = async () => (await db.pg.query('select title, posts, version from drafts where id = $1', [draft.id])).rows[0]

describe('list_revisions', () => {
  it('writes one readable line per revision, newest first, and keeps the JSON', async () => {
    const result = await call(aliceToken, 'list_revisions', { id: draft.id })
    expect(result.isError).toBe(false)
    expect(result.structuredContent.revisions.map((rev) => rev.seq)).toEqual([2, 1])
    const text = result.content[1].text
    expect(text).toMatch(/^Revision 2 by ChatGPT, (just now|\d+ minutes? ago): changed post 2, added post 3 after post 2\.$/m)
    expect(text).toMatch(/^Revision 1, .*: changed the title, added post 1 first, added post 2 after post 1\.$/m)
    expect(text).toContain(`call get_revision with id ${draft.id} and revision 2`)
    expect(text).not.toContain('```')
    expect(text).not.toContain(LONG) // the list never shows post text
  })

  it('pages with before and says when the history ends', async () => {
    const result = await call(aliceToken, 'list_revisions', { id: draft.id, limit: 1 })
    expect(result.structuredContent.next_before).toBe(2)
    expect(result.content[1].text).toContain('call list_revisions with before 2')
  })
})

describe('get_revision', () => {
  it('shows each changed post before and after as block quotes, Hebrew as written, and the restore call', async () => {
    const result = await call(aliceToken, 'get_revision', { id: draft.id, revision: 2 })
    expect(result.isError).toBe(false)
    expect(result.structuredContent.revision.seq).toBe(2)
    const text = result.content[1].text
    expect(text).toContain(`Post 2 before:\n> ${LONG}\n\nPost 2 after:\n> ${HE}`)
    expect(text).toContain('Post 3 after, added after post 2:\n> third post')
    expect(text).not.toContain('```')
    expect(text.trimEnd()).toMatch(new RegExp(`To go back to before this change, call restore_revision with id ${draft.id}, revision 1 and version 2\\. To restore this revision itself, use revision 2 instead\\.$`))
  })

  it('against current compares with the draft as it is, and a bad against is refused', async () => {
    const result = await call(aliceToken, 'get_revision', { id: draft.id, revision: 1, against: 'current' })
    expect(result.content[1].text).toContain('Compared with the draft now.')
    expect(result.content[1].text).toContain('call restore_revision with id')
    expect((await call(aliceToken, 'get_revision', { id: draft.id, revision: 1, against: 'soon' })).isError).toBe(true)
  })
})

describe('restore_revision', () => {
  it('refuses a stale version with the usual answer and writes nothing', async () => {
    const result = await call(aliceToken, 'restore_revision', { id: draft.id, revision: 1, version: 1 })
    expect(result.isError).toBe(true)
    expect(result.structuredContent.error).toMatch(/^Nothing was saved: the draft changed since you read it/)
    expect(result.structuredContent.version).toBe(2)
    expect(JSON.stringify(result.structuredContent)).not.toContain(HE) // the stale answer has no post text
    const now = await current()
    expect(now.version).toBe(2)
    expect(now.posts.map((post) => post.text)).toEqual(['first post', HE, 'third post'])
  })

  it('needs the version', async () => {
    const result = await call(aliceToken, 'restore_revision', { id: draft.id, revision: 1 })
    expect(result).toMatchObject({ isError: true })
    expect(textOf(result)).toBe('Missing required argument: version')
    expect((await current()).version).toBe(2)
  })

  it('says so when the revision is already the current state', async () => {
    const result = await call(aliceToken, 'restore_revision', { id: draft.id, revision: 2, version: 2 })
    expect(result.content[1].text).toBe('Revision 2 is already the current state. Nothing was written.')
    expect((await current()).version).toBe(2)
  })
})

describe('another user and view-as', () => {
  it("another user's draft is Draft not found, in all three tools, and nothing is written", async () => {
    for (const [name, args] of [
      ['list_revisions', { id: draft.id }],
      ['get_revision', { id: draft.id, revision: 2 }],
      ['restore_revision', { id: draft.id, revision: 1, version: 2 }]
    ]) {
      const result = await call(bobToken, name, args)
      expect(result.isError, name).toBe(true)
      expect(textOf(result), name).toBe('{"error":"Draft not found"}')
    }
    expect((await current()).version).toBe(2)
  })

  it('a view-as caller is refused and writes nothing', async () => {
    const caller = { uid: alice.id, gh: '1', login: 'alice', via: 'session', suspended: false, viewAs: { adminUid: bob.id, adminLogin: 'bob', expiresAt: Date.now() + 60000 } }
    for (const [name, args] of [
      ['list_revisions', { id: draft.id }],
      ['get_revision', { id: draft.id, revision: 2 }],
      ['restore_revision', { id: draft.id, revision: 1, version: 2 }]
    ]) {
      const result = await callTool(name, args, { caller, origin: APP_URL })
      expect(result.isError, name).toBe(true)
      expect(textOf(result), name).not.toContain(HE)
    }
    expect((await current()).version).toBe(2)
  })
})

describe('restore_revision writes', () => {
  it('restores a revision with the version, answers with the outline and no post text, and keeps the history', async () => {
    const result = await call(aliceToken, 'restore_revision', { id: draft.id, revision: 1, version: 2 })
    expect(result.isError).toBe(false)
    const text = textOf(result)
    expect(text).toContain('Restored revision 1: the draft is now version 3 with 2 posts.')
    expect(text).toMatch(/Draft \S+, version 3, 2 posts/)
    expect(text).toContain(`${APP_URL}/draft/${draft.id}`)
    expect(text).not.toContain(LONG) // outline and link only (T5)
    expect(text).not.toContain('```')
    expect(result.structuredContent.restored_from).toBe(1)
    const now = await current()
    expect(now.version).toBe(3)
    expect(now.posts.map((post) => post.text)).toEqual(['first post', LONG])
    const after = await call(aliceToken, 'list_revisions', { id: draft.id })
    expect(after.structuredContent.revisions[0].label).toBe('Restored revision 1')
  })
})
