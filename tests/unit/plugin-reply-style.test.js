// @vitest-environment node
// Plugin reply-style (docs/plans/plugin-marketplace.md, section 5, tests 3 to 6): golden fixtures, config,
// the command-line lint, the Stop hook, and a copy of the plugin folder alone.
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from '../../plugins/reply-style/scripts/config.mjs'
import { DEFAULT_CONFIG, lint } from '../../plugins/reply-style/scripts/reply-lint.mjs'
import { decide } from '../../plugins/reply-style/scripts/reply-style-stop.mjs'

const PLUGIN = fileURLToPath(new URL('../../plugins/reply-style/', import.meta.url))
const LINT = join(PLUGIN, 'scripts', 'reply-lint.mjs')
const HOOK = join(PLUGIN, 'scripts', 'reply-style-stop.mjs')
const GOLDEN = join(PLUGIN, 'fixtures', 'golden')
const TEMPLATES = join(PLUGIN, 'skills', 'reply-style', 'templates')
const KINDS = ['status-report', 'owner-question', 'handoff', 'owner-action', 'incident']
const TEMPLATE_FILES = ['handoff.md', 'incident.md', 'owner-action.md', 'owner-question.md', 'status-report.md']

// The rules each bad fixture must fail for (the same map as tests/unit/reply-lint-golden.test.js).
const WANT = {
  'status-report': {
    'bad-missing-heading': 'headings', 'bad-loose-label': ['loose-label', 'headings'], 'bad-wrong-order': 'headings',
    'bad-bare-label': 'bare-label', 'bad-unchanged': 'unchanged', 'bad-empty-details': 'empty-details',
    'bad-no-evidence': 'evidence', 'bad-steps-count': 'steps'
  },
  handoff: { 'bad-loose-label': ['loose-label', 'headings'], 'bad-missing-heading': 'headings', 'bad-bare-label': 'bare-label', 'bad-wrong-order': 'headings' },
  'owner-question': { 'bad-letter-options': 'option-letters', 'bad-loose-label': ['loose-label', 'headings'], 'bad-missing-heading': 'headings', 'bad-blocked-machine': 'blocked' },
  'owner-action': { 'bad-loose-label': ['loose-label', 'headings'], 'bad-steps-count': 'steps', 'bad-slop': 'slop' },
  incident: { 'bad-loose-label': ['loose-label', 'headings'], 'bad-emoji': 'emoji', 'bad-missing-heading': 'headings' },
}

const roots = []

/** A temp folder with files (JSON objects are written as JSON). A `.git` folder is added unless `git` is false. */
function makeDir(files = {}, { git = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'reply-style-test-'))
  roots.push(root)
  if (git) mkdirSync(join(root, '.git'))
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content))
  }
  return root
}

/** The environment for a spawned command: the real one without the variables that pick a project. */
function envWith(extra = {}) {
  const env = { ...process.env, ...extra }
  if (!('CLAUDE_PROJECT_DIR' in extra)) delete env.CLAUDE_PROJECT_DIR
  if (!('REPLY_STYLE' in extra)) delete env.REPLY_STYLE
  return env
}

const rules = (findings) => [...new Set(findings.map((f) => f.rule))].sort()
const golden = (kind, file) => readFileSync(join(GOLDEN, kind, file), 'utf8')
const SAM = loadConfig({ cwd: makeDir({ '.claude/agent-kit.json': { owner: 'Sam', repo: 'acme/sample-app' } }), env: {} })
const FAILING = { last_assistant_message: '**Done:** shipped.\n**Not done:** the prompt.' }

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('golden fixtures (sample project: owner Sam, acme/sample-app)', () => {
  it('has the five templates, and every kind has a good and a bad fixture', () => {
    expect(readdirSync(TEMPLATES).sort()).toEqual(TEMPLATE_FILES)
    for (const kind of KINDS) {
      const names = readdirSync(join(GOLDEN, kind))
      expect(names.some((f) => f.startsWith('good-')), `${kind} has no good fixture`).toBe(true)
      expect(names.some((f) => f.startsWith('bad-')), `${kind} has no bad fixture`).toBe(true)
      expect(names.filter((f) => f.startsWith('bad-')).map((f) => f.replace(/\.md$/, '')).sort()).toEqual(Object.keys(WANT[kind]).sort())
    }
  })

  describe.each(KINDS)('%s', (kind) => {
    const files = readdirSync(join(GOLDEN, kind))
    it('every good fixture passes', () => {
      for (const f of files.filter((n) => n.startsWith('good-'))) expect(lint(golden(kind, f), { template: true }, SAM), f).toEqual([])
    })
    it('every bad fixture fails for exactly its named rules', () => {
      for (const f of files.filter((n) => n.startsWith('bad-'))) {
        const want = [WANT[kind][f.replace(/\.md$/, '')]].flat().sort()
        expect(rules(lint(golden(kind, f), { template: true }, SAM)), `${kind}/${f}`).toEqual(want)
      }
    })
  })
})

describe('config', () => {
  it('no file gives the defaults', () => {
    expect(loadConfig({ cwd: makeDir(), env: {} })).toEqual(DEFAULT_CONFIG)
    expect(DEFAULT_CONFIG).toEqual({
      owner: 'the owner',
      ownerLogin: '',
      repo: '',
      replyStyle: { humans: ['you', 'your', 'the owner'], allowLines: [], maxLineLength: 160, changelogAreas: [], extraTemplates: {}, writingSkills: [] },
    })
  })

  it('humans decide which "blocked on" names are a person', () => {
    const kim = loadConfig({ cwd: makeDir({ '.claude/agent-kit.json': { 'reply-style': { humans: ['Kim'] } } }), env: {} })
    expect(lint('Blocked on Kim for the review.', {}, kim)).toEqual([])
    expect(rules(lint('Blocked on Kim for the review.', {}, DEFAULT_CONFIG))).toEqual(['blocked'])
  })

  it('an allowLines pattern skips a long line', () => {
    const long = `Implements #12 Task 3 ${'word '.repeat(40)}`
    const allow = loadConfig({ cwd: makeDir({ '.claude/agent-kit.json': { 'reply-style': { allowLines: ['^Implements #\\d+ Task '] } } }), env: {} })
    expect(rules(lint(long, {}, DEFAULT_CONFIG))).toEqual(['bare-label', 'long-line'])
    expect(lint(long, {}, allow)).toEqual([])
  })

  it('maxLineLength sets the long-line rule', () => {
    const short = loadConfig({ cwd: makeDir({ '.claude/agent-kit.json': { 'reply-style': { maxLineLength: 20 } } }), env: {} })
    const line = 'This line is thirty chars long.'
    expect(rules(lint(line, {}, short))).toEqual(['long-line'])
    expect(lint(line, {}, DEFAULT_CONFIG)).toEqual([])
  })

  it('changelogAreas: a list rejects other areas; an empty list accepts any one word', () => {
    const body = (area) => `# A title for a person\n- One short line.\nArea: ${area}\nLink: https://github.com/acme/sample-app/pull/34\n`
    const docs = loadConfig({ cwd: makeDir({ '.claude/agent-kit.json': { 'reply-style': { changelogAreas: ['Docs'] } } }), env: {} })
    expect(rules(lint(body('Editor'), { kind: 'changelog' }, docs))).toEqual(['shape'])
    expect(lint(body('Docs'), { kind: 'changelog' }, docs)).toEqual([])
    expect(lint(body('Editor'), { kind: 'changelog' }, DEFAULT_CONFIG)).toEqual([])
    expect(rules(lint(body('AI apps'), { kind: 'changelog' }, DEFAULT_CONFIG))).toEqual(['shape'])
  })

  it('a broken file throws ConfigError naming the key or the file', () => {
    const badType = loadConfig.bind(null, { cwd: makeDir({ '.claude/agent-kit.json': { 'reply-style': { maxLineLength: 'x' } } }), env: {} })
    expect(badType).toThrow(ConfigError)
    expect(badType).toThrow(/maxLineLength/)
    const badJson = makeDir({ '.claude/agent-kit.json': '{ not json' })
    expect(() => loadConfig({ cwd: badJson, env: {} })).toThrow(ConfigError)
    expect(() => loadConfig({ cwd: badJson, env: {} })).toThrow(/agent-kit\.json/)
  })

  it('CLAUDE_PROJECT_DIR wins over the working folder', () => {
    const projectDir = makeDir({ '.claude/agent-kit.json': { owner: 'Env' } })
    const cwd = makeDir({ '.claude/agent-kit.json': { owner: 'Cwd' } })
    expect(loadConfig({ cwd, env: { CLAUDE_PROJECT_DIR: projectDir } }).owner).toBe('Env')
    expect(loadConfig({ cwd, env: {} }).owner).toBe('Cwd')
  })

  it('walking up stops at the folder with .git', () => {
    const outer = makeDir({ '.claude/agent-kit.json': { owner: 'Outer' } }, { git: false })
    const proj = join(outer, 'proj')
    mkdirSync(join(proj, '.git'), { recursive: true })
    mkdirSync(join(proj, 'sub'))
    expect(loadConfig({ cwd: join(proj, 'sub'), env: {} }).owner).toBe('the owner')
    mkdirSync(join(proj, '.claude'))
    writeFileSync(join(proj, '.claude', 'agent-kit.json'), JSON.stringify({ owner: 'Proj' }))
    expect(loadConfig({ cwd: join(proj, 'sub'), env: {} }).owner).toBe('Proj')
  })
})

describe('command-line lint', () => {
  it('exits 1 with findings on a bad fixture', () => {
    const cwd = makeDir()
    const bad = join(GOLDEN, 'status-report', 'bad-unchanged.md')
    const run = spawnSync(process.execPath, [LINT, '--template', bad], { cwd, env: envWith(), encoding: 'utf8' })
    expect(run.status).toBe(1)
    expect(run.stdout).toContain('unchanged')
  })

  it('reads the file named as the only argument, not stdin (Codex finding on PR 524)', () => {
    const cwd = makeDir()
    const bad = join(GOLDEN, 'status-report', 'bad-unchanged.md')
    const run = spawnSync(process.execPath, [LINT, bad], { cwd, env: envWith(), encoding: 'utf8', input: '' })
    expect(run.status).toBe(1)
    expect(run.stdout).toContain('unchanged')
  })

  it('reads the file after a --config value', () => {
    const cwd = makeDir({ 'cfg.json': { owner: 'Sam' } })
    const bad = join(GOLDEN, 'status-report', 'bad-unchanged.md')
    const run = spawnSync(process.execPath, [LINT, '--config', join(cwd, 'cfg.json'), bad], { cwd, env: envWith(), encoding: 'utf8', input: '' })
    expect(run.status).toBe(1)
    expect(run.stdout).toContain('unchanged')
  })

  it('exits 2 and names the key when the config file is broken', () => {
    const cwd = makeDir({ '.claude/agent-kit.json': { 'reply-style': { maxLineLength: 'x' } } })
    const good = join(GOLDEN, 'status-report', 'good-1.md')
    const run = spawnSync(process.execPath, [LINT, good], { cwd, env: envWith(), encoding: 'utf8' })
    expect(run.status).toBe(2)
    expect(run.stderr).toContain('maxLineLength')
  })
})

describe('Stop hook', () => {
  it('does nothing unless REPLY_STYLE=owner', () => {
    expect(decide(FAILING, {}, SAM)).toBeNull()
  })

  it('blocks a failing reply and names the config owner', () => {
    const result = decide(FAILING, { REPLY_STYLE: 'owner' }, SAM)
    expect(result.decision).toBe('block')
    expect(result.reason).toContain('Sam')
    expect(result.reason).toContain('loose-label')
  })

  it('never blocks twice in a row (stop_hook_active)', () => {
    expect(decide({ ...FAILING, stop_hook_active: true }, { REPLY_STYLE: 'owner' }, SAM)).toBeNull()
  })

  it('a broken config prints a warning on stderr, nothing on stdout, and exits 0', () => {
    const cwd = makeDir({ '.claude/agent-kit.json': '{ broken' })
    const run = spawnSync(process.execPath, [HOOK], {
      cwd,
      env: envWith({ REPLY_STYLE: 'owner', CLAUDE_PROJECT_DIR: cwd }),
      input: JSON.stringify(FAILING),
      encoding: 'utf8',
    })
    expect(run.status).toBe(0)
    expect(run.stdout).toBe('')
    expect(run.stderr).toContain('reply-style: config ignored:')
  })
})

describe('the plugin folder alone', () => {
  it('lints and blocks from a copied folder that reads only its own config', () => {
    const root = makeDir({ '.claude/agent-kit.json': { owner: 'Sam', repo: 'acme/sample-app' } })
    const copy = join(root, 'reply-style')
    cpSync(PLUGIN, copy, { recursive: true })
    const bad = join(copy, 'fixtures', 'golden', 'status-report', 'bad-unchanged.md')

    const lintRun = spawnSync(process.execPath, [join(copy, 'scripts', 'reply-lint.mjs'), '--template', bad], { cwd: root, env: envWith(), encoding: 'utf8' })
    expect(lintRun.status).toBe(1)

    const hookRun = spawnSync(process.execPath, [join(copy, 'scripts', 'reply-style-stop.mjs')], {
      cwd: root,
      env: envWith({ REPLY_STYLE: 'owner', CLAUDE_PROJECT_DIR: root }),
      input: JSON.stringify(FAILING),
      encoding: 'utf8',
    })
    expect(hookRun.status).toBe(0)
    const out = JSON.parse(hookRun.stdout)
    expect(out.decision).toBe('block')
    expect(out.reason).toContain('Sam')
  })
})
