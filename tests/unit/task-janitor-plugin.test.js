// @vitest-environment node
// The task-janitor plugin (plugins/task-janitor): the repository's wrappers run the plugin's main(), a copy of the
// plugin runs on its own (no path above its root), and a broken project config stops the command with the key named.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readConfig } from '../../plugins/task-janitor/scripts/config.mjs'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const PLUGIN = join(ROOT, 'plugins/task-janitor')
const SNAPSHOT = join(ROOT, 'tests/unit/fixtures/janitor/snapshot.json')
const node = (args, opts = {}) => spawnSync(process.execPath, args, { encoding: 'utf8', ...opts })

describe('the repository wrappers run the plugin', () => {
  it.each(['janitor', 'session-janitor', 'status-board'])('scripts/%s.mjs with no arguments prints its usage and exits 2', (name) => {
    const out = node([join(ROOT, 'scripts', `${name}.mjs`)], { cwd: ROOT })
    expect(out.status).toBe(2)
    expect(out.stderr).toContain('usage:')
  })

  it('every wrapper re-exports the plugin module it runs', () => {
    for (const name of ['janitor', 'session-janitor', 'status-board']) {
      const wrapper = readFileSync(join(ROOT, 'scripts', `${name}.mjs`), 'utf8')
      expect(wrapper, name).toContain(`../plugins/task-janitor/scripts/${name}.mjs`)
      expect(wrapper, name).toContain('export * from')
    }
  })
})

describe('the plugin on its own', () => {
  it('runs from a copy outside the repository and says the reply check is not checked without a replyLint', () => {
    const dir = mkdtempSync(join(tmpdir(), 'task-janitor-copy-'))
    try {
      cpSync(PLUGIN, join(dir, 'task-janitor'), { recursive: true })
      const out = node([join(dir, 'task-janitor/scripts/janitor.mjs'), 'report', SNAPSHOT], { cwd: dir, env: { ...process.env, CLAUDE_PROJECT_DIR: dir } })
      expect(out.status, out.stderr).toBe(0)
      expect(out.stdout).toContain('Reply style: not checked')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a broken project config stops the command with exit 2 and names the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'task-janitor-config-'))
    try {
      mkdirSync(join(dir, '.claude'))
      writeFileSync(join(dir, '.claude/agent-kit.json'), '{ not json')
      const out = node([join(PLUGIN, 'scripts/janitor.mjs'), 'report', SNAPSHOT], { cwd: dir, env: { ...process.env, CLAUDE_PROJECT_DIR: dir } })
      expect(out.status).toBe(2)
      expect(out.stderr).toContain('not valid JSON')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('readConfig', () => {
  const file = (text) => {
    const dir = mkdtempSync(join(tmpdir(), 'task-janitor-read-'))
    const path = join(dir, 'agent-kit.json')
    writeFileSync(path, text)
    return { path, dir }
  }

  it('a missing file means no settings', () => {
    expect(readConfig(null)).toEqual({ data: {}, error: null })
  })

  it('names the key of the wrong type', () => {
    const { path, dir } = file(JSON.stringify({ 'task-janitor': { reportIssue: 'twelve' } }))
    try {
      expect(readConfig(path).error).toContain('"task-janitor.reportIssue" must be a whole number')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('accepts the section as written in this repository', () => {
    const { path, dir } = file(JSON.stringify({ 'task-janitor': { manualTestsIssue: 430, reportIssue: 497, dispatcherIssue: 154, replyLint: 'plugins/reply-style/scripts/reply-lint.mjs' } }))
    try {
      expect(readConfig(path).error).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
