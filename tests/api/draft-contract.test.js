// @vitest-environment node
// Plan docs/plans/draft-contract.md section 5.1 (#395, task W6): the contract lint. It runs on the real server modules
// and one seeded draft (an English and a Hebrew post). No model, no network. The draft is seeded once in beforeAll;
// the write tools run once each, in order, and every check reads those results.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({
  putBlob: vi.fn(async (pathname) => ({ url: `https://store.public.blob.vercel-storage.com/${pathname}` })),
  deleteBlobUrls: vi.fn(async () => {})
}))

import { route } from '../../server/router.js'
import { issuePair } from '../../server/oauth/tokens.js'
import { setResolverForTests } from '../../server/remote-image.js'
import { isCleanServerText } from '../../server/mcp/language.js'
import { INSTRUCTIONS } from '../../server/mcp/server.js'
import { getPrompt, listPrompts } from '../../server/mcp/prompts.js'
import { readSkillResource } from '../../server/mcp/skills.js'
import { listAdminTools } from '../../server/mcp/admin-tools.js'
import { fenceProblems } from '../eval/discovery/format.mjs'
import { APP_URL, setupTestDb } from './helpers/db.js'
import { makePng } from './helpers/images.js'

const MCP = `${APP_URL}/api/mcp`
const MODERN = '2026-07-28'
const SKILL_URI = 'skill://x-thread-drafts/SKILL.md'
const EN = 'Coffee notes: one thread, two posts.'
const HE = 'שרשור על קפה ☕ עם X/טוויטר, ושורה שנייה'
const PUSHY = /\b(must|always|ignore|IMPORTANT|MUST)\b/
// The state line (server/mcp/state-line.js, plan section 3): only server words, the id, numbers and the editor link.
const STATE = /^Draft [0-9a-f-]{36}, version \d+, \d+ posts?, \d+ over 280, \d+ images?\. Editor: https:\/\/\S+\/draft\/[0-9a-f-]{36}\. .+$/
// The fixed hint sentence of each tool group (plan section 3).
const HINT = {
  read: /^To change a post, call update_post with this id, the post's id from posts, and version \d+\.$/,
  outline: /^Call get_draft for the text, or update_post to change a post\.$/,
  rewrite: /^Saved\. Say in one line what changed; if no card shows the thread, quote the changed posts\.$/,
  edit: /^Saved\. Say in one line what changed; quote only the changed posts, not the whole draft\.$/,
  image: /^(Saved\. Post \d+ has \d of 4 images\. Say this in one line\.|Saved\. Say in one line which images changed; the draft has \d+ images? in all\.)$/
}
const GROUP = {
  create_draft: 'read',
  create_thread_from_text: 'read',
  get_draft: 'read',
  duplicate_draft: 'read',
  get_draft_outline: 'outline',
  update_draft: 'rewrite',
  add_post: 'edit',
  update_post: 'edit',
  remove_post: 'edit',
  move_post: 'edit',
  add_image_from_url: 'image',
  remove_image: 'image'
}
// Results whose markdown part carries the thread in both languages (#356, #392).
const MARKDOWN_TOOLS = ['create_draft', 'create_thread_from_text', 'get_draft', 'update_draft']
const sumImages = (draft) => draft.posts.reduce((n, p) => n + (p.image_count ?? p.images?.length ?? 0), 0)
const RANDOM_ID = '00000000-0000-4000-8000-000000000000'

let token
let draftId
const seen = {}

function request(method, params) {
  const h = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}`, 'mcp-protocol-version': MODERN, 'mcp-method': method }
  if (method === 'tools/call') h['mcp-name'] = params.name
  const body = { jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN } } }
  return new Request(MCP, { method: 'POST', headers: h, body: JSON.stringify(body) })
}

/** One tools/call: the result object (content parts, isError). */
async function call(name, args) {
  const res = await route(request('tools/call', { name, arguments: args }))
  return JSON.parse(await res.text()).result
}

/** The JSON text part (content[0]) of a successful result. */
const jsonOf = (result) => JSON.parse(result.content[0].text)
const textParts = (result) => result.content.filter((part) => part.type === 'text').map((part) => part.text)

beforeAll(async () => {
  const db = await setupTestDb()
  const user = await db.insertUser({ github_id: 7, login: 'contract' })
  await db.pg.query("insert into oauth_clients (client_id, kind, client_name) values ('xtc_contract_test', 'registered', 'Test') on conflict do nothing")
  const { rows } = await db.pg.query("insert into oauth_grants (user_id, client_id, scope, resource) values ($1, 'xtc_contract_test', 'drafts', $2) returning id", [user.id, MCP])
  token = (await issuePair(rows[0].id)).access_token

  seen.create_draft = await call('create_draft', { title: 'Contract', posts: [{ text: EN }, { text: HE }] })
  const id = jsonOf(seen.create_draft).draft.id
  draftId = id
  const current = async () => jsonOf(await call('get_draft', { id })).draft ?? jsonOf(await call('get_draft', { id }))
  seen.get_draft = await call('get_draft', { id })
  seen.get_draft_outline = await call('get_draft_outline', { id })
  const first = (await current()).posts[0]
  seen.update_post = await call('update_post', { id, post_id: first.id, text: `${EN} Edited.` })
  seen.add_post = await call('add_post', { id, text: 'Third post, added.' })
  const posts = (await current()).posts
  seen.move_post = await call('move_post', { id, post_id: posts[posts.length - 1].id, position: 1 })
  const again = (await current()).posts
  seen.remove_post = await call('remove_post', { id, post_id: again[again.length - 1].id })
  seen.update_draft = await call('update_draft', { id, title: 'Contract, rewritten', posts: [{ text: EN }, { text: HE }] })
  seen.duplicate_draft = await call('duplicate_draft', { id })
  seen.create_thread_from_text = await call('create_thread_from_text', { text: `${EN}\n\n${HE}`, title: 'Thread' })
  seen.error = await call('update_post', { id: RANDOM_ID, post_id: 'p1', text: 'x' })
  setResolverForTests(async () => [{ address: '93.184.216.34', family: 4 }])
  vi.stubGlobal('fetch', vi.fn(async () => new Response(makePng(), { headers: { 'content-type': 'image/png' } })))
  const firstPost = (await current()).posts[0]
  seen.add_image_from_url = await call('add_image_from_url', { draftId: id, url: 'https://example.com/n.png', postId: firstPost.id, position: 1 })
  const imageUrl = (await current()).posts[0].images[0].url
  seen.remove_image = await call('remove_image', { draftId: id, url: imageUrl })
}, 20000)

afterAll(() => {
  setResolverForTests(null)
  vi.unstubAllGlobals()
})

describe('contract lint: server instructions', () => {
  it('holds R1, R3 and R4 in short form, is at most 1024 bytes, clean, and has no pushy word', () => {
    expect(INSTRUCTIONS).toContain('without asking')
    expect(INSTRUCTIONS).toContain('Do not repeat text a view shows')
    expect(INSTRUCTIONS).toContain('numbered block quotes')
    expect(Buffer.byteLength(INSTRUCTIONS)).toBeLessThanOrEqual(1024)
    expect(isCleanServerText(INSTRUCTIONS)).toBe(true)
    expect(INSTRUCTIONS).not.toMatch(PUSHY)
    expect(fenceProblems(INSTRUCTIONS, { server: true })).toEqual([])
  })
})

describe('contract lint: prompts and skill', () => {
  // Each prompt takes its own arguments (prompts.js); the free text is the sample, the draft is the seeded one.
  const promptArgs = () => ({ rewrite_hook: { draft: draftId, goal: EN }, tighten_draft: { draft: draftId }, thread_from_notes: { notes: EN, goal: EN } })
  const promptText = (name) => getPrompt(name, promptArgs()[name], { origin: APP_URL }).result.messages.map((m) => m.content.text).join('\n')

  it('rewrite_hook, tighten_draft and thread_from_notes carry the block-quote, one-line and no-repeat rules', () => {
    expect(promptText('rewrite_hook')).toMatch(/block quote/i)
    expect(promptText('tighten_draft')).toMatch(/block quote/i)
    expect(promptText('tighten_draft')).toMatch(/one line/i)
    expect(promptText('thread_from_notes')).toMatch(/do not repeat/i)
  })

  it('every prompt description and every message it builds is free of code-block requests and pushy words', () => {
    for (const prompt of listPrompts()) {
      expect(fenceProblems(prompt.description, { server: true }), prompt.name).toEqual([])
      expect(prompt.description, prompt.name).not.toMatch(PUSHY)
    }
    for (const name of Object.keys(promptArgs())) {
      const text = promptText(name)
      expect(fenceProblems(text, { server: true, allowed: ['user'] }), name).toEqual([])
      expect(text, name).not.toMatch(PUSHY)
    }
  })

  it('the skill has the Working on a draft section with R1 to R9, under 8192 bytes', () => {
    const skill = readSkillResource(SKILL_URI)[0].text
    expect(Buffer.byteLength(skill)).toBeLessThan(8192)
    expect(skill).toContain('## Working on a draft')
    const KEY = { 1: 'at once', 2: 'update_post', 3: 'one or two lines', 4: 'block quote', 5: 'Hebrew', 6: 'One option per item', 7: 'update_post', 8: 'copy block', 9: 'image count' }
    const lines = skill.slice(skill.indexOf('## Working on a draft')).split('\n')
    for (let n = 1; n <= 9; n += 1) {
      const start = lines.findIndex((line) => line.startsWith(`- R${n}. `))
      expect(start, `R${n}`).toBeGreaterThanOrEqual(0)
      let rule = lines[start]
      for (let k = start + 1; k < lines.length && lines[k].startsWith('  '); k += 1) rule += ` ${lines[k]}`
      expect(rule, `R${n}`).toContain(KEY[n])
    }
    expect(skill).toMatch(/never a block of code/i)
  })

  it('the skill sample answer is numbered block quotes, one of them Hebrew, with no fence', () => {
    const skill = readSkillResource(SKILL_URI)[0].text
    const sample = skill.slice(skill.indexOf('### Sample answer')).split(/\n##+ /)[0]
    const items = sample.split('\n').filter((line) => /^\d+\. > /.test(line))
    expect(items.length).toBeGreaterThanOrEqual(3)
    expect(sample).not.toMatch(/^\s*(`{3,}|~{3,})/m)
    expect(items.some((line) => /[֐-׿]/.test(line))).toBe(true)
  })
})

describe('contract lint: draft results (state line, text, Hebrew, admin silence)', () => {
  const names = Object.keys(GROUP)

  it('every successful draft result ends with a state line that matches the pattern, the hint of its group, and the JSON', () => {
    for (const name of names) {
      const result = seen[name]
      expect(result.isError, name).not.toBe(true)
      const last = textParts(result).at(-1)
      expect(last, name).toMatch(STATE)
      // The hint is the sentence after the editor link; it must be the fixed one for the tool's group.
      const hint = last.replace(/^.*\/draft\/[0-9a-f-]{36}\. /, '')
      expect(hint, name).toMatch(HINT[GROUP[name]])
      const body = jsonOf(result)
      const draft = body.draft ?? body
      expect(last.startsWith(`Draft ${draft.id}, version ${draft.version}, `), name).toBe(true)
      if (name === 'add_image_from_url') expect(last, name).toContain('Post 1 has 1 of 4 images.')
      const count = draft.post_count ?? draft.posts.length
      expect(last, name).toContain(`, ${count} post${count === 1 ? '' : 's'}, `)
      const images = Number(last.match(/, (\d+) images?\. Editor/)[1])
      expect(images, name).toBe(sumImages(draft))
    }
  })

  it('an error result has no state line', () => {
    expect(seen.error.isError).toBe(true)
    expect(textParts(seen.error).join('\n')).not.toContain('Editor:')
  })

  it('no result text part has a code fence, except the one copy block of a thread result', () => {
    for (const name of [...names, 'error']) {
      for (const text of textParts(seen[name])) {
        // The copy block is allowed only behind its exact label (fenceProblems). Which results carry one is not the rule here:
        // edit results carry the markdown thread too, which the plan's list of four does not name (flagged in the PR).
        expect(fenceProblems(text, { allowed: ['copy'] }), name).toEqual([])
      }
    }
  })

  it('Hebrew post text comes back byte-identical in the markdown part, and in the JSON of get_draft (full text)', () => {
    for (const name of MARKDOWN_TOOLS) {
      const markdown = textParts(seen[name]).slice(1, -1).join('\n')
      expect(markdown, name).toContain(HE)
    }
    // The write results carry 40-character previews in JSON (the outline), so only get_draft has the full text there.
    expect(textParts(seen.get_draft)[0]).toContain(HE)
  })

  it('no result text names an admin tool', () => {
    const admin = listAdminTools().map((tool) => tool.name)
    expect(admin.length).toBeGreaterThan(0)
    for (const name of [...names, 'error']) {
      for (const text of textParts(seen[name])) {
        for (const tool of admin) expect(text, `${name} names ${tool}`).not.toContain(tool)
      }
    }
  })
})
