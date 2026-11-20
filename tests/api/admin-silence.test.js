// @vitest-environment node
// Admin plan A3 (issue #183): the word "admin" appears in no public text. Admin tools are found by
// the admin only, and the docs, the API description and the MCP text the public can read do not name them.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({ putBlob: vi.fn(), deleteBlobUrls: vi.fn(async () => {}) }))

import { route } from '../../server/router.js'
import { INSTRUCTIONS } from '../../server/mcp/server.js'
import { getPrompt, listPrompts } from '../../server/mcp/prompts.js'
import { listSkillResources, listSkills, readSkillResource } from '../../server/mcp/skills.js'
import { listTools } from '../../server/mcp/tools.js'
import { listUiResources, readUiResource } from '../../server/mcp/ui/index.js'
import { APP_URL, setupTestDb } from './helpers/db.js'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const ADMIN_WORD = /admin/i

beforeAll(async () => {
  await setupTestDb()
})

const readRepoFile = (path) => readFileSync(join(ROOT, path), 'utf8')

/** The answer of a GET to the app, as text. */
async function getText(path) {
  const res = await route(new Request(`${APP_URL}${path}`, { method: 'GET' }))
  return res.text()
}

describe('the word admin is absent from public text', () => {
  it('the public docs and llms.txt', () => {
    for (const file of ['public/llms.txt', 'docs/agents/api.md', 'docs/agents/mcp.md']) {
      expect({ file, hit: ADMIN_WORD.test(readRepoFile(file)) }).toEqual({ file, hit: false })
    }
  })

  it('the served OpenAPI document and both well-known answers', async () => {
    for (const path of ['/api/openapi.json', '/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server']) {
      const text = await getText(path)
      expect({ path, hit: ADMIN_WORD.test(text) }).toEqual({ path, hit: false })
    }
  })

  it('the server instructions and the tool list a caller without admin rights sees', () => {
    expect(ADMIN_WORD.test(INSTRUCTIONS)).toBe(false)
    expect(JSON.stringify(listTools())).not.toMatch(ADMIN_WORD)
  })

  it('the prompts and their texts', () => {
    expect(JSON.stringify(listPrompts())).not.toMatch(ADMIN_WORD)
    for (const prompt of listPrompts()) {
      const args = Object.fromEntries((prompt.arguments ?? []).filter((arg) => arg.required).map((arg) => [arg.name, 'sample']))
      const got = getPrompt(prompt.name, args, { origin: APP_URL })
      expect(got.problem).toBeUndefined()
      expect(JSON.stringify(got.result)).not.toMatch(ADMIN_WORD)
    }
  })

  it('the UI resources that resources/list and resources/read return', () => {
    const resources = listUiResources()
    expect(resources.length).toBeGreaterThan(0)
    for (const resource of resources) {
      expect(JSON.stringify(resource)).not.toMatch(ADMIN_WORD)
      expect(JSON.stringify(readUiResource(resource.uri))).not.toMatch(ADMIN_WORD)
    }
  })

  it('the skill text and the skill list', () => {
    expect(JSON.stringify(listSkills())).not.toMatch(ADMIN_WORD)
    for (const resource of listSkillResources()) {
      expect(JSON.stringify(readSkillResource(resource.uri))).not.toMatch(ADMIN_WORD)
    }
  })
})
