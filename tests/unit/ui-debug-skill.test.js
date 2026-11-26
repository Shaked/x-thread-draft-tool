// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The ui-debug skill is tested by default: it, its script and its command exist, the index and AGENTS.md point to it,
// its wording stays generic (it becomes a plugin skill later), and every file and npm script it names is real.
const read = (file) => readFileSync(file, 'utf8')
const SKILL = '.claude/skills/ui-debug/SKILL.md'

describe('ui-debug skill', () => {
  it('has its files', () => {
    for (const file of [SKILL, 'scripts/ui-shot.mjs', '.claude/commands/ui-debug.md', 'tests/e2e/ui-shot.spec.ts']) expect(existsSync(file), file).toBe(true)
  })
  it('is in the skill index and in AGENTS.md', () => {
    expect(read('CLAUDE.md')).toContain('[`.claude/skills/ui-debug/SKILL.md`](./.claude/skills/ui-debug/SKILL.md)')
    expect(read('AGENTS.md')).toContain('UI work: read `ui-debug` first')
  })
  it('has the front matter of a skill', () => {
    const text = read(SKILL)
    expect(text).toMatch(/^---\nname: ui-debug\ndescription: .{40,}\n---\n/)
  })
  it('covers what it must', () => {
    const text = read(SKILL)
    for (const part of [
      'npm run dev:api', 'vite preview', '/api/dev/session', 'playwright install', '--trace off', '--scale', '390', '1280', 'light', 'dark', 'rtl',
      'console errors', 'axe', 'design-tokens.test.js', '44 px', '--inspect', '--stale-chunk', 'docs/screenshots/', 'reply-style'
    ]) expect(text, part).toContain(part)
  })
  it('stays generic: no app name, owner name or issue numbers', () => {
    for (const file of [SKILL, '.claude/commands/ui-debug.md']) {
      const text = read(file)
      expect(text, file).not.toMatch(/x-thread|shaked|\bXThread\b|\bxt[_-]/i)
      expect(text, file).not.toMatch(/#\d+/)
    }
  })
  it('names only files and npm scripts that exist', () => {
    const text = read(SKILL) + read('.claude/commands/ui-debug.md')
    const scripts = JSON.parse(read('package.json')).scripts
    for (const [, name] of text.matchAll(/npm run ([\w:-]+)/g)) expect(scripts[name], `npm run ${name}`).toBeDefined()
    for (const [, file] of text.matchAll(/`((?:scripts|tests|\.claude)\/[\w./-]+\.(?:mjs|js|ts|md))`/g)) expect(existsSync(file), file).toBe(true)
  })
})
