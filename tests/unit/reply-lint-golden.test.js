// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RULES, lint } from '../../scripts/reply-lint.mjs'

// Golden fixtures (#486): every template kind has a good example that passes and bad examples that fail
// for exactly the rules named in WANT (the file name maps to its rule there). A kind without fixtures, or a bad fixture without a named rule, fails here.
const GOLDEN = new URL('./fixtures/reply-lint/golden/', import.meta.url)
const TEMPLATES = new URL('../../.claude/skills/reply-style/templates/', import.meta.url)
const KIND_OF_TEMPLATE = { 'changelog-entry': 'changelog', 'telegram-message': 'telegram' }
const options = (kind) => (kind === 'changelog' || kind === 'telegram' ? { kind } : { template: true })
const WANT = {
  'status-report': {
    'bad-missing-heading': 'headings', 'bad-loose-label': ['loose-label', 'headings'], 'bad-wrong-order': 'headings',
    'bad-bare-label': 'bare-label', 'bad-unchanged': 'unchanged', 'bad-empty-details': 'empty-details',
    'bad-no-evidence': 'evidence', 'bad-steps-count': 'steps', 'bad-session-link': 'session-link',
    'bad-tldr': 'tldr', 'bad-long-line': 'long-line'
  },
  handoff: { 'bad-session-link': 'session-link', 'bad-loose-label': ['loose-label', 'headings'], 'bad-missing-heading': 'headings', 'bad-bare-label': 'bare-label', 'bad-wrong-order': 'headings' },
  'owner-question': { 'bad-letter-options': 'option-letters', 'bad-loose-label': ['loose-label', 'headings'], 'bad-missing-heading': 'headings', 'bad-blocked-machine': 'blocked' },
  'owner-action': { 'bad-loose-label': ['loose-label', 'headings'], 'bad-steps-count': 'steps', 'bad-slop': 'slop' },
  incident: { 'bad-loose-label': ['loose-label', 'headings'], 'bad-emoji': 'emoji', 'bad-missing-heading': 'headings' },
  telegram: { 'bad-no-emoji-headline': 'shape', 'bad-empty-section': 'empty-section', 'bad-too-long': 'shape', 'bad-no-app-name': 'app-name' },
  changelog: { 'bad-label': 'internal-label', 'bad-area': 'shape', 'bad-no-title': 'shape' },
  'janitor-summary': { 'bad-missing-heading': 'headings', 'bad-bare-label': 'bare-label', 'bad-session-link': 'session-link' },
  // The status board (#499): its good fixture is the golden output of scripts/status-board.mjs (tests/unit/status-board.test.js).
  'status-board': { 'bad-blocked-group': 'blocked', 'bad-waiting-you': 'waiting-human', 'bad-bare-label': 'bare-label', 'bad-steps-count': 'steps', 'bad-session-link': 'session-link' }
}
const kinds = readdirSync(TEMPLATES).filter((f) => f.endsWith('.md')).map((f) => {
  const name = f.replace(/\.md$/, '')
  return KIND_OF_TEMPLATE[name] || name
})
const files = (kind) => readdirSync(new URL(`${kind}/`, GOLDEN)).filter((f) => f.endsWith('.md'))
const text = (kind, file) => readFileSync(new URL(`${kind}/${file}`, GOLDEN), 'utf8')

describe('reply-lint golden fixtures', () => {
  it('every template file has a fixture folder with a good and a bad fixture, and a WANT entry', () => {
    expect(kinds.length).toBeGreaterThan(0)
    for (const kind of kinds) {
      expect(existsSync(new URL(`${kind}/`, GOLDEN)), `template ${kind} has no fixtures folder`).toBe(true)
      expect(WANT[kind], `template ${kind} has no WANT entry`).toBeTruthy()
      const names = files(kind)
      expect(names.some((f) => f.startsWith('good-')), `${kind} has no good fixture`).toBe(true)
      expect(names.some((f) => f.startsWith('bad-')), `${kind} has no bad fixture`).toBe(true)
    }
  })

  describe.each(kinds)('%s', (kind) => {
    it('good fixtures pass', () => {
      for (const f of files(kind).filter((n) => n.startsWith('good-'))) expect(lint(text(kind, f), options(kind)), f).toEqual([])
    })
    it('every bad fixture has a named rule and fails for it', () => {
      const bad = files(kind).filter((n) => n.startsWith('bad-'))
      for (const f of bad) {
        const want = WANT[kind]?.[f.replace(/\.md$/, '')]
        expect(want, `${kind}/${f} has no rule in WANT`).toBeTruthy()
        // Exactly the named rules: a bad fixture is a one-change copy of its good one. Naming a rule twice is
        // allowed for the loose label, because it forces the heading check too.
        const found = [...new Set(lint(text(kind, f), options(kind)).map((x) => x.rule))].sort()
        expect(found, `${kind}/${f}`).toEqual([want].flat().sort())
      }
      expect(bad.map((f) => f.replace(/\.md$/, '')).sort()).toEqual(Object.keys(WANT[kind]).sort())
    })
  })

  it('every lint rule has a bad fixture that fails for it', () => {
    const covered = new Set(Object.values(WANT).flatMap((k) => Object.values(k).flat()))
    for (const rule of RULES) expect(covered.has(rule), `rule ${rule} has no failing fixture`).toBe(true)
  })

  it('RULES lists exactly the rule names the lint reports', () => {
    const source = readFileSync(new URL('../../scripts/reply-lint.mjs', import.meta.url), 'utf8')
    const used = new Set([...source.matchAll(/\badd\([^,()]+,\s*'([a-z-]+)'/g)].map((m) => m[1]))
    expect([...used].sort()).toEqual([...RULES].sort())
  })

  it('the skill lists every template in its table and every rule in "Before you send"', () => {
    const skill = readFileSync(new URL('../../.claude/skills/reply-style/SKILL.md', import.meta.url), 'utf8')
    const before = skill.split('## Before you send')[1]?.split(/\n## /)[0] ?? ''
    for (const f of readdirSync(TEMPLATES).filter((n) => n.endsWith('.md'))) expect(skill.includes(`templates/${f}`), `${f} is not in the skill`).toBe(true)
    for (const rule of RULES) expect(before.includes(`\`${rule}\``), `rule ${rule} is not in "Before you send"`).toBe(true)
  })

  it('a Details section that holds only a fenced block is not empty (Codex finding on #487)', () => {
    const base = text('status-report', 'good-1.md')
    expect(lint(`${base}\n## Details\n\`\`\`\nnpm run test:unit\n\`\`\`\n`, { template: true })).toEqual([])
  })

  it.each(['**Done**: x', '*Done:* x', '1. **Done:** x', '> **Done:** x', '- **Not done:** y', '**Done**'])('flags the loose label %s', (line) => {
    expect(lint(line).map((f) => f.rule)).toContain('loose-label')
  })

  it('loose bold labels fail even without --template (a chat reply with no headings)', () => {
    const reply = '**Done:** shipped.\n**Not done:** the prompt.\n**Blocked on you:** nothing.\n'
    const rules = lint(reply).map((f) => f.rule)
    expect(rules).toContain('loose-label')
    expect(rules).toContain('headings')
  })
})
