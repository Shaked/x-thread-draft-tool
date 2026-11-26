// @vitest-environment node
// Plugin metrics (task #453, M8 of the central metrics plan): the config script with golden fixtures, the skills'
// shape, and a copy of the plugin folder alone (what the plugin cache holds) run in a temp project.
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { ConfigError, loadMetricsConfig, missingKeys } from '../../plugins/metrics/scripts/metrics-config.mjs'

const PLUGIN = fileURLToPath(new URL('../../plugins/metrics/', import.meta.url))
const FIXTURES = join(PLUGIN, 'fixtures', 'config')
const SKILLS = join(PLUGIN, 'skills')
const SAMPLE = { app: 'Sample app', repo: 'acme/sample-app', siteUrl: 'https://sample-app.example.com', ingestUrl: 'https://sample-app.example.com/api/ops/events' }

// What each bad fixture must report: a ConfigError that names this text, or the keys that stay missing.
const WANT_ERROR = { 'bad-http.json': /metrics\.siteUrl.*https/, 'bad-repo.json': /metrics\.repo.*owner\/name/, 'bad-app-type.json': /metrics\.app.*non-empty string/ }
const WANT_MISSING = { 'bad-missing-ingest.json': ['ingestUrl'] }

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A temp project with a `.git` folder and the given `.claude/agent-kit.json` text. */
function project(text) {
  const root = mkdtempSync(join(tmpdir(), 'metrics-test-'))
  roots.push(root)
  mkdirSync(join(root, '.git'))
  if (text !== undefined) {
    mkdirSync(join(root, '.claude'))
    writeFileSync(join(root, '.claude', 'agent-kit.json'), text)
  }
  return root
}

const fixture = (name) => readFileSync(join(FIXTURES, name), 'utf8')
const load = (text) => loadMetricsConfig({ cwd: project(text), env: {} })

describe('golden config fixtures (sample project acme/sample-app)', () => {
  it('every fixture is either good, or listed in this test with what it must report', () => {
    const bad = readdirSync(FIXTURES).filter((f) => f.startsWith('bad-')).sort()
    expect(bad).toEqual([...Object.keys(WANT_ERROR), ...Object.keys(WANT_MISSING)].sort())
    expect(readdirSync(FIXTURES).filter((f) => f.startsWith('good-')).length).toBeGreaterThan(0)
  })

  for (const name of readdirSync(FIXTURES).filter((f) => f.startsWith('good-'))) {
    it(`${name} gives all four values`, () => {
      const config = load(fixture(name))
      expect(config).toEqual(SAMPLE)
      expect(missingKeys(config)).toEqual([])
    })
  }

  for (const [name, message] of Object.entries(WANT_ERROR)) {
    it(`${name} is refused with the key named`, () => {
      expect(() => load(fixture(name))).toThrow(ConfigError)
      expect(() => load(fixture(name))).toThrow(message)
    })
  }

  for (const [name, keys] of Object.entries(WANT_MISSING)) {
    it(`${name} leaves ${keys.join(', ')} missing`, () => {
      expect(missingKeys(load(fixture(name)))).toEqual(keys)
    })
  }
})

describe('config', () => {
  it('no file means every value is empty', () => {
    expect(missingKeys(load(undefined))).toEqual(['app', 'repo', 'siteUrl', 'ingestUrl'])
  })

  it('a file that is not JSON names the file', () => {
    expect(() => load('{ not json')).toThrow(/agent-kit\.json is not valid JSON/)
  })

  it('CLAUDE_PROJECT_DIR wins over the working folder', () => {
    const projectDir = project(JSON.stringify({ metrics: { app: 'From env' } }))
    const cwd = project(JSON.stringify({ metrics: { app: 'From cwd' } }))
    expect(loadMetricsConfig({ cwd, env: { CLAUDE_PROJECT_DIR: projectDir } }).app).toBe('From env')
  })
})

describe('skills', () => {
  const names = readdirSync(SKILLS)

  it('has the skills of this version', () => {
    expect(names.sort()).toEqual(['metrics-emit'])
  })

  for (const name of names) {
    it(`${name}: front matter names the folder, the config script is named, lines stay under 160 characters`, () => {
      const text = readFileSync(join(SKILLS, name, 'SKILL.md'), 'utf8')
      const front = text.match(/^---\nname: (.+)\ndescription: (.+)\n---\n/)
      expect(front, 'front matter').not.toBeNull()
      expect(front[1]).toBe(name)
      expect(front[2].length).toBeGreaterThan(40)
      expect(text).toContain('${CLAUDE_PLUGIN_ROOT}/scripts/metrics-config.mjs')
      for (const line of text.split('\n')) expect(line.length, line).toBeLessThanOrEqual(160)
    })
  }
})

describe('install test: the plugin folder alone, in a temp project', () => {
  it('runs the config script from a copy, with no file above the plugin root', () => {
    const copy = mkdtempSync(join(tmpdir(), 'metrics-plugin-copy-'))
    roots.push(copy)
    cpSync(PLUGIN, join(copy, 'metrics'), { recursive: true })
    const script = join(copy, 'metrics', 'scripts', 'metrics-config.mjs')
    const env = { ...process.env, CLAUDE_PROJECT_DIR: project(fixture('good-1.json')) }
    const run = spawnSync('node', [script], { encoding: 'utf8', env, cwd: copy })
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('repo: acme/sample-app')
    expect(run.stdout).toContain('ingestUrl: https://sample-app.example.com/api/ops/events')
  })

  it('exits 1 and says which values to set when one is missing, and exits 2 for a broken file', () => {
    const script = join(PLUGIN, 'scripts', 'metrics-config.mjs')
    const missing = spawnSync('node', [script], { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: project(fixture('bad-missing-ingest.json')) } })
    expect(missing.status).toBe(1)
    expect(missing.stdout).toContain('ingestUrl: (not set)')
    expect(missing.stdout).toContain('Set metrics.ingestUrl')
    const broken = spawnSync('node', [script], { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: project(fixture('bad-http.json')) } })
    expect(broken.status).toBe(2)
    expect(broken.stderr).toContain('metrics.siteUrl')
  })
})

describe('this repository', () => {
  it('reads the plugin skills by symlink and has its own metrics settings', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
    expect(readFileSync(join(root, '.claude', 'skills', 'metrics-emit', 'SKILL.md'), 'utf8')).toBe(readFileSync(join(SKILLS, 'metrics-emit', 'SKILL.md'), 'utf8'))
    const config = loadMetricsConfig({ cwd: root, env: {} })
    expect(missingKeys(config)).toEqual([])
  })
})
