// @vitest-environment node
// Plugin pr-workflow (docs/plans/plugin-marketplace.md, section 7, step 3): the helper's argument parsing and
// repository lookup, run with a stub `gh` on PATH, so no network and no GitHub call.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const HELPER = join(REPO_ROOT, 'plugins', 'pr-workflow', 'scripts', 'agent-pr.sh')
const WRAPPER = join(REPO_ROOT, 'scripts', 'agent-pr.sh')
const MARKETPLACE = join(REPO_ROOT, '.claude-plugin', 'marketplace.json')

const dirs = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true })
})

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'pr-workflow-'))
  dirs.push(dir)
  return dir
}

/** A folder with a stub `gh` that appends its arguments to a log and prints `GH_OUT`. */
function stubBin() {
  const bin = tempDir()
  const gh = join(bin, 'gh')
  writeFileSync(gh, '#!/usr/bin/env bash\nprintf "%s\\n" "$@" >> "$GH_LOG"\nprintf "%s\\n" "${GH_OUT:-}"\n')
  chmodSync(gh, 0o755)
  return { bin, log: join(bin, 'gh.log') }
}

/** A git repository with one commit on `branch`. `origin` sets an origin remote; `config` writes .claude/agent-kit.json. */
function repo({ branch = 'feature', origin, config } = {}) {
  const dir = tempDir()
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  git('init', '-q', '-b', branch)
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'user.name', 'test')
  writeFileSync(join(dir, 'README.md'), 'x\n')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  if (origin) git('remote', 'add', 'origin', origin)
  if (config !== undefined) {
    mkdirSync(join(dir, '.claude'))
    writeFileSync(join(dir, '.claude', 'agent-kit.json'), config)
  }
  return dir
}

/** Runs the helper with a clean environment: no inherited CLAUDE_PROJECT_DIR or AGENT_PR_REPO unless given. */
function run(args, { cwd, env = {}, gh } = {}) {
  const stub = gh ?? stubBin()
  const result = spawnSync('bash', [HELPER, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: `${stub.bin}:${process.env.PATH}`,
      HOME: stub.bin,
      GH_LOG: stub.log,
      ...env,
    },
  })
  const calls = (() => {
    try {
      return readFileSync(stub.log, 'utf8').split('\n').filter(Boolean)
    } catch {
      return []
    }
  })()
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, calls }
}

describe('repository lookup', () => {
  it('prints AGENT_PR_REPO when it is set', () => {
    const out = run(['repo'], { cwd: repo(), env: { AGENT_PR_REPO: 'acme/sample-app' } })
    expect(out.status).toBe(0)
    expect(out.stdout.trim()).toBe('acme/sample-app')
  })

  it('reads "repo" from .claude/agent-kit.json before the origin remote', () => {
    const dir = repo({
      origin: 'git@github.com:acme/origin-repo.git',
      config: JSON.stringify({ owner: 'Sam', repo: 'acme/config-repo' }),
    })
    const out = run(['repo'], { cwd: dir })
    expect(out.stdout.trim()).toBe('acme/config-repo')
  })

  it('falls back to the origin remote, ssh or https, without the .git suffix', () => {
    const ssh = run(['repo'], { cwd: repo({ origin: 'git@github.com:acme/sample-app.git' }) })
    expect(ssh.stdout.trim()).toBe('acme/sample-app')
    const https = run(['repo'], { cwd: repo({ origin: 'https://github.com/acme/sample-app' }) })
    expect(https.stdout.trim()).toBe('acme/sample-app')
  })

  it('a config file without a repo key falls through to the origin remote', () => {
    const dir = repo({ origin: 'https://github.com/acme/sample-app.git', config: '{"owner":"Sam"}' })
    expect(run(['repo'], { cwd: dir }).stdout.trim()).toBe('acme/sample-app')
  })

  it('exits 1 with the sources named when nothing gives a repository', () => {
    const out = run(['repo'], { cwd: repo() })
    expect(out.status).toBe(1)
    expect(out.stderr).toContain('no repository: set AGENT_PR_REPO')
  })

  it('exits 1 and names the file when the config is not JSON', () => {
    const out = run(['repo'], { cwd: repo({ config: '{ not json' }) })
    expect(out.status).toBe(1)
    expect(out.stderr).toContain('agent-kit.json is not JSON')
  })

  it('exits 1 when "repo" is not a string', () => {
    const out = run(['repo'], { cwd: repo({ config: '{"repo": 12}' }) })
    expect(out.status).toBe(1)
    expect(out.stderr).toContain('its "repo" key is not a string')
  })

  it('refuses a value that is not owner/name', () => {
    const out = run(['repo'], { cwd: repo(), env: { AGENT_PR_REPO: 'just-a-name' } })
    expect(out.status).toBe(1)
    expect(out.stderr).toContain('repository must be owner/name, got: just-a-name')
  })
})

describe('argument parsing', () => {
  it('no command prints the usage and exits 1', () => {
    const out = run([], { cwd: repo() })
    expect(out.status).toBe(1)
    expect(out.stdout).toContain('agent-pr.sh repo')
  })

  it('an unknown command exits 1 and calls nothing', () => {
    const out = run(['merge'], { cwd: repo() })
    expect(out.status).toBe(1)
    expect(out.calls).toEqual([])
  })

  it('branch without a name stops with the usage', () => {
    const out = run(['branch'], { cwd: repo() })
    expect(out.status).not.toBe(0)
    expect(out.stderr).toContain('usage: branch <name>')
  })

  it('pr with a missing body file refuses before any call', () => {
    const out = run(['pr', 'A title', '/nonexistent/body.md'], { cwd: repo(), env: { AGENT_PR_REPO: 'acme/sample-app' } })
    expect(out.status).toBe(1)
    expect(out.stderr).toContain('body file not found')
    expect(out.calls).toEqual([])
  })

  it('pr without a body argument stops with the usage', () => {
    const out = run(['pr', 'only a title'], { cwd: repo(), env: { AGENT_PR_REPO: 'acme/sample-app' } })
    expect(out.status).not.toBe(0)
    expect(out.stderr).toContain('usage: pr <title> <body-file>')
  })
})

describe('calls to GitHub, through a stub gh', () => {
  it('pr posts the title, head, base and body to the pulls endpoint', () => {
    const dir = repo({ branch: 'claude/510-demo' })
    writeFileSync(join(dir, 'body.md'), 'Body text\n')
    const stub = stubBin()
    const out = run(['pr', 'Demo title', join(dir, 'body.md')], {
      cwd: dir,
      env: { AGENT_PR_REPO: 'acme/sample-app', GH_OUT: 'https://example.invalid/pull/1' },
      gh: stub,
    })
    expect(out.status).toBe(0)
    expect(out.stdout.trim()).toBe('https://example.invalid/pull/1')
    expect(out.calls).toEqual([
      'api',
      'repos/acme/sample-app/pulls',
      '-f',
      'title=Demo title',
      '-f',
      'head=claude/510-demo',
      '-f',
      'base=main',
      '-F',
      `body=@${join(dir, 'body.md')}`,
      '--jq',
      '.html_url',
    ])
  })

  it('checks reads the check runs of HEAD by default, and of a given commit', () => {
    const dir = repo()
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim()
    const stub = stubBin()
    const out = run(['checks'], { cwd: dir, env: { AGENT_PR_REPO: 'acme/sample-app' }, gh: stub })
    expect(out.status).toBe(0)
    expect(out.calls[1]).toBe(`repos/acme/sample-app/commits/${head}/check-runs`)
    const other = run(['checks', 'HEAD~0'], { cwd: dir, env: { AGENT_PR_REPO: 'acme/sample-app' }, gh: stubBin() })
    expect(other.calls[1]).toBe(`repos/acme/sample-app/commits/${head}/check-runs`)
  })
})

describe('push refuses what it must', () => {
  it('refuses main', () => {
    const out = run(['push'], { cwd: repo({ branch: 'main' }) })
    expect(out.status).toBe(1)
    expect(out.stderr).toContain('refusing to push main')
  })

  it('refuses uncommitted changes before any network call', () => {
    const dir = repo({ branch: 'claude/510-demo' })
    writeFileSync(join(dir, 'README.md'), 'changed\n')
    const out = run(['push'], { cwd: dir })
    expect(out.status).toBe(1)
    expect(out.stderr).toContain('uncommitted changes')
  })
})

describe('the project wrapper and the marketplace entry', () => {
  it('the wrapper hands every command but smoke to the plugin helper', () => {
    const out = spawnSync('bash', [WRAPPER, 'merge'], { encoding: 'utf8', cwd: REPO_ROOT, env: { PATH: process.env.PATH } })
    expect(out.status).toBe(1)
    expect(out.stdout).toContain('agent-pr.sh repo')
  })

  it('the wrapper prints the repository through the plugin', () => {
    const out = spawnSync('bash', [WRAPPER, 'repo'], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      env: { PATH: process.env.PATH, AGENT_PR_REPO: 'acme/sample-app' },
    })
    expect(out.status).toBe(0)
    expect(out.stdout.trim()).toBe('acme/sample-app')
  })

  it('the marketplace lists pr-workflow at the version its manifest has', () => {
    const market = JSON.parse(readFileSync(MARKETPLACE, 'utf8'))
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'plugins', 'pr-workflow', '.claude-plugin', 'plugin.json'), 'utf8'))
    const entry = market.plugins.find((p) => p.name === 'pr-workflow')
    expect(entry.source).toBe('./plugins/pr-workflow')
    expect(entry.version).toBe(manifest.version)
  })
})
