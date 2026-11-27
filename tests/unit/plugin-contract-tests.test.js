// @vitest-environment node
// The contract-tests plugin (docs/plans/plugin-marketplace.md, step 1b-4): manifests and forbidden strings,
// the plugin skill has no repository path, and this repository's skill keeps its owner rules and links to the plugin.
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { checkManifests, forbiddenStrings } from '../../scripts/plugin-manifests.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PLUGIN = 'plugins/contract-tests'
const PLUGIN_SKILL = `${PLUGIN}/skills/contract-tests/SKILL.md`
const PROJECT_SKILL = '.claude/skills/e2e-contract-tests.md'
const read = (path) => readFileSync(`${ROOT}${path}`, 'utf8')

// Words that name this repository, its helpers or its tools. The plugin skill must contain none of them.
const REPO_TERMS = [/route\(/, /server\//, /tests\//, /PGlite/i, /setQueryImpl/, /mcp-contract/, /\.claude\//, /npm run/, /LLM/, /Claude Code/, /Codex/, /ChatGPT/]

describe('contract-tests plugin manifests', () => {
  it('the whole marketplace passes the manifest and forbidden-string checks', () => {
    expect(checkManifests(ROOT)).toEqual([])
    expect(forbiddenStrings(ROOT)).toEqual([])
  })

  it('the marketplace lists the plugin at the same version as its manifest', () => {
    const market = JSON.parse(read('.claude-plugin/marketplace.json'))
    const entry = market.plugins.find((p) => p.name === 'contract-tests')
    expect(entry).toMatchObject({ source: `./${PLUGIN}`, version: '0.1.0' })
    const manifest = JSON.parse(read(`${PLUGIN}/.claude-plugin/plugin.json`))
    expect(manifest).toMatchObject({ name: 'contract-tests', version: '0.1.0', license: 'MIT', author: { name: 'Shaked' } })
    expect(manifest.network.hosts).toEqual([])
  })

  it('the CHANGELOG has the version section and the plugin LICENSE equals the root LICENSE', () => {
    expect(read(`${PLUGIN}/CHANGELOG.md`).split('\n')).toContain('## 0.1.0')
    expect(read(`${PLUGIN}/LICENSE`)).toBe(read('LICENSE'))
  })

  it('the plugin ships no scripts, hooks or dependencies: it is text for an agent', () => {
    expect(existsSync(`${ROOT}${PLUGIN}/scripts`)).toBe(false)
    expect(existsSync(`${ROOT}${PLUGIN}/hooks`)).toBe(false)
    expect(existsSync(`${ROOT}${PLUGIN}/package.json`)).toBe(false)
  })
})

describe('contract-tests plugin skill', () => {
  const skill = read(PLUGIN_SKILL)

  it('has a frontmatter name and description, and the nine steps in order', () => {
    expect(skill.startsWith('---\nname: contract-tests\ndescription: ')).toBe(true)
    const steps = skill.split('\n').filter((line) => /^\d+\. \*\*/.test(line))
    expect(steps.map((line) => Number(line.match(/^(\d+)\./)[1]))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('names no path, helper, tool, model or client of this repository', () => {
    const hits = REPO_TERMS.filter((term) => term.test(skill)).map((term) => term.source)
    expect(hits).toEqual([])
  })

  it('keeps the generic protocol assertions that real clients depend on', () => {
    for (const word of ['code challenge method', 'authentication method', 'metadata document', 'registration endpoint', 'cache-control: no-store', 'invalid-grant', 'revokes the grant']) {
      expect(skill).toContain(word)
    }
  })

  it('does not carry an exception to the never-claim rule', () => {
    expect(skill).toMatch(/Never write "verified with a real client"\.$/m)
    expect(skill).not.toMatch(/unless a real client was run/)
  })

  it('keeps the atomic, idempotent and no-manual-check rules', () => {
    expect(skill).toMatch(/No manual checks/)
    expect(skill).toMatch(/Writes under test must be atomic and idempotent/)
  })
})

describe('this repository keeps its own rules and points at the plugin', () => {
  const project = read(PROJECT_SKILL)

  it('links to the plugin skill, which exists', () => {
    expect(project).toContain(`${PLUGIN}/skills/contract-tests/SKILL.md`)
    expect(existsSync(`${ROOT}${PLUGIN_SKILL}`)).toBe(true)
  })

  it('keeps the owner rules and this repository\'s helpers', () => {
    expect(project).toMatch(/## Owner rules \(non-negotiable\)/)
    expect(project).toMatch(/The app calls no LLM and has no opt-in LLM path/)
    expect(project).toContain('server/router.js')
    expect(project).toContain('tests/api/helpers/db.js')
  })

  it('keeps this app\'s protocol values that real clients depend on', () => {
    for (const word of ['S256', 'none', 'metadata document', '{error, error_description}', 'JSON-RPC', 'invalid_grant', 'cache-control: no-store', 'state', 'iss', '401']) {
      expect(project).toContain(word)
    }
  })
})
