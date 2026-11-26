// @vitest-environment node
// Task 507 (docs/plans/plugin-marketplace.md, section 5, tests 1 and 2): plugin manifests and forbidden strings.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkManifests, forbiddenStrings, versionBumps } from '../../scripts/plugin-manifests.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const MARKETPLACE = {
  name: 'agent-kit',
  description: 'Generic skills for agents.',
  owner: { name: 'Shaked' },
  plugins: [
    { name: 'reply-style', source: './plugins/reply-style', version: '0.1.0', description: 'Reply templates.' },
  ],
}

const PLUGIN = {
  name: 'reply-style',
  version: '0.1.0',
  description: 'Reply templates.',
  author: { name: 'Shaked' },
  license: 'MIT',
  network: { hosts: [] },
}

let roots = []

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'plugin-manifests-'))
  roots.push(root)
  return root
}

function write(root, path, content) {
  const full = join(root, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content, null, 2))
}

/** A marketplace with one plugin that passes every rule. `overrides` replaces files by path (null deletes nothing). */
function goodRoot(overrides = {}) {
  const root = makeRoot()
  const files = {
    '.claude-plugin/marketplace.json': MARKETPLACE,
    'plugins/reply-style/.claude-plugin/plugin.json': PLUGIN,
    'plugins/reply-style/README.md': '# reply-style\n\nReply templates.\n',
    'plugins/reply-style/CHANGELOG.md': '# Changelog\n\n## 0.1.0\n\n- Start.\n',
    ...overrides,
  }
  for (const [path, content] of Object.entries(files)) write(root, path, content)
  return root
}

const messages = (problems) => problems.map((p) => p.message)

beforeEach(() => {
  roots = []
})

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('checkManifests', () => {
  it('passes a good marketplace with one plugin', () => {
    expect(checkManifests(goodRoot())).toEqual([])
  })

  it('reports a missing marketplace.json', () => {
    const root = makeRoot()
    expect(messages(checkManifests(root))).toEqual(['marketplace.json is missing'])
  })

  it('reports a marketplace that is not JSON', () => {
    const problems = checkManifests(goodRoot({ '.claude-plugin/marketplace.json': '{ not json' }))
    expect(problems).toHaveLength(1)
    expect(problems[0].message).toMatch(/not valid JSON/)
  })

  it('reports a missing marketplace owner.name', () => {
    const market = { ...MARKETPLACE, owner: {} }
    expect(messages(checkManifests(goodRoot({ '.claude-plugin/marketplace.json': market })))).toContain(
      'marketplace owner.name is missing',
    )
  })

  it('reports a plugin name that is not kebab-case', () => {
    const market = { ...MARKETPLACE, plugins: [{ ...MARKETPLACE.plugins[0], name: 'Reply_Style' }] }
    expect(messages(checkManifests(goodRoot({ '.claude-plugin/marketplace.json': market })))).toContain(
      'plugin name "Reply_Style" is not kebab-case',
    )
  })

  it('reports a reserved prefix', () => {
    const market = { ...MARKETPLACE, plugins: [{ ...MARKETPLACE.plugins[0], name: 'claude-style' }] }
    expect(messages(checkManifests(goodRoot({ '.claude-plugin/marketplace.json': market })))).toContain(
      'plugin name "claude-style" uses a reserved prefix',
    )
  })

  it('reports a source with ".."', () => {
    const market = { ...MARKETPLACE, plugins: [{ ...MARKETPLACE.plugins[0], source: './plugins/../plugins/reply-style' }] }
    expect(messages(checkManifests(goodRoot({ '.claude-plugin/marketplace.json': market })))).toEqual([
      'plugin "reply-style" source must start with "./" and must not contain ".."',
    ])
  })

  it('reports a source that is not an existing folder', () => {
    const market = { ...MARKETPLACE, plugins: [{ ...MARKETPLACE.plugins[0], source: './plugins/missing' }] }
    expect(messages(checkManifests(goodRoot({ '.claude-plugin/marketplace.json': market })))[0]).toMatch(
      /is not an existing folder/,
    )
  })

  it('reports a plugin version that does not match the marketplace entry', () => {
    const problems = checkManifests(goodRoot({ 'plugins/reply-style/.claude-plugin/plugin.json': { ...PLUGIN, version: '0.2.0' } }))
    expect(messages(problems)).toEqual([
      'version "0.2.0" does not match marketplace entry version "0.1.0"',
      'CHANGELOG.md has no section "## 0.2.0"',
    ])
  })

  it('reports a plugin name that does not match the marketplace entry', () => {
    const problems = checkManifests(goodRoot({ 'plugins/reply-style/.claude-plugin/plugin.json': { ...PLUGIN, name: 'other' } }))
    expect(messages(problems)[0]).toMatch(/does not match marketplace entry/)
  })

  it('reports a missing network.hosts array', () => {
    const problems = checkManifests(goodRoot({ 'plugins/reply-style/.claude-plugin/plugin.json': { ...PLUGIN, network: {} } }))
    expect(messages(problems)).toEqual(['plugin network.hosts must be an array'])
  })

  it('reports a missing README.md', () => {
    const root = goodRoot()
    rmSync(join(root, 'plugins/reply-style/README.md'))
    expect(messages(checkManifests(root))).toEqual(['README.md is missing'])
  })

  it('reports a CHANGELOG.md without a section for the current version', () => {
    const problems = checkManifests(goodRoot({ 'plugins/reply-style/CHANGELOG.md': '# Changelog\n\n## 0.0.9\n\n- Old.\n' }))
    expect(messages(problems)).toEqual(['CHANGELOG.md has no section "## 0.1.0"'])
  })

  it('reports a plugin LICENSE that differs from the root LICENSE', () => {
    const problems = checkManifests(
      goodRoot({ LICENSE: 'MIT text\n', 'plugins/reply-style/LICENSE': 'Other text\n' }),
    )
    expect(messages(problems)).toEqual(['LICENSE does not equal the root LICENSE'])
  })

  it('reports a missing plugin LICENSE when the root LICENSE exists', () => {
    const problems = checkManifests(goodRoot({ LICENSE: 'MIT text\n' }))
    expect(messages(problems)).toEqual(['LICENSE is missing (the root LICENSE exists)'])
  })

  it('passes when the plugin LICENSE equals the root LICENSE', () => {
    expect(checkManifests(goodRoot({ LICENSE: 'MIT text\n', 'plugins/reply-style/LICENSE': 'MIT text\n' }))).toEqual([])
  })
})

describe('forbiddenStrings', () => {
  it('passes a clean plugin tree', () => {
    expect(forbiddenStrings(goodRoot())).toEqual([])
  })

  it('flags Shaked in a README', () => {
    const problems = forbiddenStrings(goodRoot({ 'plugins/reply-style/README.md': 'Written by Shaked.\n' }))
    expect(problems).toEqual([{ file: 'plugins/reply-style/README.md', line: 1, match: 'Shaked' }])
  })

  it('flags #99 in a skill file', () => {
    const problems = forbiddenStrings(
      goodRoot({ 'plugins/reply-style/skills/reply/SKILL.md': 'Line one.\nSee #99 for context.\n' }),
    )
    expect(problems).toEqual([{ file: 'plugins/reply-style/skills/reply/SKILL.md', line: 2, match: '#99' }])
  })

  it('allows #12 and #34', () => {
    expect(forbiddenStrings(goodRoot({ 'plugins/reply-style/README.md': 'Sample #12 and #34.\n' }))).toEqual([])
  })

  it('flags each other forbidden word', () => {
    const text = 'x-thread-draft-tool\nThread Draft\ndocs/plans/a.md\ndocs/operations/b.md\nXT_TOKEN\n'
    const matches = forbiddenStrings(goodRoot({ 'plugins/reply-style/notes.txt': text })).map((p) => p.match)
    expect(matches).toEqual(['x-thread-draft-tool', 'Thread Draft', 'docs/plans/', 'docs/operations/', 'XT_'])
  })

  it('exempts owner.name and author.name in JSON manifests', () => {
    expect(forbiddenStrings(goodRoot())).toEqual([])
  })

  it('flags the same word in a JSON description, which is not exempt', () => {
    const market = { ...MARKETPLACE, description: 'Written by Shaked.' }
    const problems = forbiddenStrings(goodRoot({ '.claude-plugin/marketplace.json': market }))
    expect(problems).toEqual([{ file: '.claude-plugin/marketplace.json', line: 3, match: 'Shaked' }])
  })

  it('exempts a LICENSE file under plugins/*/', () => {
    expect(forbiddenStrings(goodRoot({ 'plugins/reply-style/LICENSE': 'Copyright (c) 2026 Shaked\n' }))).toEqual([])
  })
})

describe('versionBumps', () => {
  const OLD = { 'plugins/reply-style/.claude-plugin/plugin.json': JSON.stringify({ name: 'reply-style', version: '0.1.0' }) }
  const NEW_SAME = OLD
  const NEW_BUMPED = {
    'plugins/reply-style/.claude-plugin/plugin.json': JSON.stringify({ name: 'reply-style', version: '0.1.1' }),
  }
  const readFrom = (map) => (path) => (path in map ? map[path] : null)

  it('fails a changed plugin whose version did not change', () => {
    const problems = versionBumps(['plugins/reply-style/README.md'], readFrom(OLD), readFrom(NEW_SAME))
    expect(problems).toHaveLength(1)
    expect(problems[0].plugin).toBe('reply-style')
  })

  it('passes a changed plugin whose version was bumped', () => {
    expect(versionBumps(['plugins/reply-style/README.md'], readFrom(OLD), readFrom(NEW_BUMPED))).toEqual([])
  })

  it('passes a new plugin with no old manifest', () => {
    expect(versionBumps(['plugins/reply-style/README.md'], readFrom({}), readFrom(NEW_SAME))).toEqual([])
  })

  it('ignores a change outside plugins/', () => {
    expect(versionBumps(['.claude-plugin/marketplace.json', 'src/main.jsx'], readFrom(OLD), readFrom(NEW_SAME))).toEqual([])
  })
})

describe('plugin manifests on the real repository', () => {
  it('has no manifest problems', () => {
    expect(checkManifests(REPO_ROOT)).toEqual([])
  })

  it('has no forbidden strings', () => {
    expect(forbiddenStrings(REPO_ROOT)).toEqual([])
  })
})
