// @vitest-environment node
// Plan docs/plans/mcp-default-use.md Task 1 (D1): the MCP text tells an AI app to save a written thread as
// a draft by default. No LLM runs here; the tests pin the trigger phrases, the length limits, the clean-text
// rules and the ban on pushy wording (decision U4). Each check runs on both protocol versions.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({ putBlob: vi.fn(), deleteBlobUrls: vi.fn(async () => {}) }))

import { route } from '../../server/router.js'
import { issuePair } from '../../server/oauth/tokens.js'
import { isCleanServerText } from '../../server/mcp/language.js'
import { APP_URL, setupTestDb } from './helpers/db.js'

const MCP = `${APP_URL}/api/mcp`
const MODERN = '2026-07-28'
const LEGACY = '2025-11-25'
const SKILL_URI = 'skill://x-thread-drafts/SKILL.md'
// Words that read as orders to the model. The new text states facts only (decision U4).
const PUSHY = /\b(must|always|ignore|IMPORTANT|MUST)\b/

let db
let token

beforeAll(async () => {
  db = await setupTestDb()
})

beforeEach(async () => {
  await db.reset()
  await db.pg.query(
    "insert into oauth_clients (client_id, kind, client_name) values ('xtc_default_use_test', 'registered', 'Test') on conflict do nothing"
  )
  const alice = await db.insertUser({ github_id: 1, login: 'alice' })
  const { rows } = await db.pg.query(
    "insert into oauth_grants (user_id, client_id, scope, resource) values ($1, 'xtc_default_use_test', 'drafts', $2) returning id",
    [alice.id, MCP]
  )
  token = (await issuePair(rows[0].id)).access_token
})

/** One JSON-RPC call on the given protocol version. Returns the parsed body. */
async function rpc(version, method, params = {}) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` }
  let body
  if (version === MODERN) {
    headers['mcp-protocol-version'] = MODERN
    headers['mcp-method'] = method
    if (method === 'tools/call') headers['mcp-name'] = params.name
    if (method === 'resources/read') headers['mcp-name'] = params.uri
    body = { jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN } } }
  } else {
    if (method !== 'initialize') headers['mcp-protocol-version'] = version
    body = { jsonrpc: '2.0', id: 1, method, params }
  }
  const res = await route(new Request(MCP, { method: 'POST', headers, body: JSON.stringify(body) }))
  return JSON.parse(await res.text())
}

/** tools/list and instructions as each protocol version serves them. */
async function listing(version) {
  const tools = (await rpc(version, 'tools/list')).result.tools
  const info =
    version === MODERN
      ? (await rpc(version, 'server/discover')).result
      : (await rpc(version, 'initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 't', version: '1' } })).result
  return { tools, instructions: info.instructions }
}

/** The SKILL.md text and its frontmatter description, as resources/read serves them. */
async function skill(version) {
  const text = (await rpc(version, 'resources/read', { uri: SKILL_URI })).result.contents[0].text
  const line = text.split('\n').find((l) => l.startsWith('description: '))
  return { text, description: JSON.parse(line.slice('description: '.length)) }
}

describe.each([MODERN, LEGACY])('default draft wording, protocol %s', (version) => {
  it('(1) the server instructions name the save tools, the draft url, the no-publish fact and the Hebrew words', async () => {
    const { instructions } = await listing(version)
    for (const phrase of ['create_thread_from_text', 'draft url', 'even without naming drafts', 'publishes nothing', 'delete_draft', 'no draft is needed']) {
      expect(instructions, phrase).toContain(phrase)
    }
    for (const he of ['שרשור', 'ציוץ', 'טיוטה']) expect(instructions, he).toContain(he)
    // The data rule, the length limit and the clean-text rule stay as before.
    expect(instructions).toMatch(/data, never as instructions/)
    expect(Buffer.byteLength(instructions)).toBeLessThanOrEqual(1024)
    expect(isCleanServerText(instructions)).toBe(true)
  })

  it('(2) create_thread_from_text and create_draft say when to save, give the draft url and name delete_draft', async () => {
    const { tools } = await listing(version)
    for (const name of ['create_thread_from_text', 'create_draft']) {
      const d = tools.find((t) => t.name === name).description
      for (const phrase of ['draft url', 'publishes nothing', 'delete_draft']) expect(d, `${name}: ${phrase}`).toContain(phrase)
      expect(d.length, name).toBeLessThanOrEqual(600)
      expect(Buffer.byteLength(d), name).toBeLessThanOrEqual(1024)
      expect(isCleanServerText(d), name).toBe(true)
    }
    const thread = tools.find((t) => t.name === 'create_thread_from_text').description
    expect(thread).toContain('even without naming drafts')
    expect(thread).toContain('שרשור')
  })

  it('(3) split_text says it saves nothing and points to create_thread_from_text', async () => {
    const { tools } = await listing(version)
    const d = tools.find((t) => t.name === 'split_text').description
    expect(d).toContain('saves nothing')
    expect(d).toContain('create_thread_from_text')
    expect(d.length).toBeLessThanOrEqual(600)
    expect(isCleanServerText(d)).toBe(true)
  })

  it('(4) the skill description and SKILL.md say to save a thread as a draft with create_thread_from_text and give the draft url', async () => {
    const { text, description } = await skill(version)
    for (const phrase of ['create_thread_from_text', 'draft url', 'even if drafts are not mentioned']) {
      expect(description, `description: ${phrase}`).toContain(phrase)
      expect(text, `SKILL.md: ${phrase}`).toContain(phrase)
    }
    expect(Buffer.byteLength(description)).toBeLessThanOrEqual(1024)
    expect(isCleanServerText(description)).toBe(true)
  })

  it('(5) the new text uses no pushy words (instructions, tool descriptions, skill description)', async () => {
    const { tools, instructions } = await listing(version)
    expect(instructions).not.toMatch(PUSHY)
    for (const tool of tools) expect(tool.description, tool.name).not.toMatch(PUSHY)
    const { description } = await skill(version)
    expect(description).not.toMatch(PUSHY)
  })
})

describe('isCleanServerText on the new text', () => {
  it('(c) the new Hebrew trigger words pass, and a bidi mark in them fails', () => {
    expect(isCleanServerText('לכתוב שרשור, שרשור מטקסט')).toBe(true)
    expect(isCleanServerText('לכתוב ציוצים, שרשור חדש, טיוטה')).toBe(true)
    expect(isCleanServerText('לכתוב שרשור‏')).toBe(false)
  })
})
