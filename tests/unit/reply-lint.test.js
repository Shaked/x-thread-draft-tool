// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HEADINGS, lint } from '../../scripts/reply-lint.mjs'

// bad-*.md are three real replies of 2026-11-21 (task #353); good-*.md are the validator's rewrites.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const fixture = (name) => read(`./fixtures/reply-lint/${name}.md`)
const rules = (text, options) => lint(text, options).map((f) => f.rule)

describe('reply-lint on the three real replies', () => {
  it.each(['a', 'b', 'c'])('reply %s fails before the rewrite and passes after', (id) => {
    expect(rules(fixture(`bad-${id}`))).toContain('bare-label')
    expect(lint(fixture(`good-${id}`), { template: true })).toEqual([])
  })
})

describe('reply-lint rules', () => {
  it('accepts a label with a link or 3 to 6 words, only checks the first mention', () => {
    expect(rules('[#279 tool text wording](https://x.test/279), then #279 again.')).toEqual([])
    expect(rules('#279 (tool text wording) and `#280` in code.')).toEqual([])
    expect(rules('#279 (wording) and Q1.')).toEqual(['bare-label', 'bare-label'])
  })

  it('flags letter options, unchanged, machine blocks, waiting on a human, emoji and slop', () => {
    expect(rules('Pick A, B or C.')).toEqual(['option-letters'])
    for (const text of ['- **A (recommended):** keep it', 'Reply "A", "B" or "C".', 'Reply `A`.', '(a) Allow zoom']) {
      expect(rules(text), text).toEqual(['option-letters'])
    }
    expect(rules('The plan is unchanged.')).toEqual(['unchanged'])
    expect(rules('CI is blocked. Blocked on your answer. Use code blocks.')).toEqual(['blocked'])
    expect(rules('`main` blocked by CI.')).toEqual(['blocked'])
    expect(rules('Waiting for your answer.')).toEqual(['waiting-human'])
    expect(rules('BM25 scores')).toEqual([])
    expect(rules('Done ✅. Let us delve in.')).toEqual(['emoji', 'slop'])
    expect(rules('x'.repeat(161))).toEqual(['long-line'])
  })

  it('checks the template headings, the TL;DR and the step count', () => {
    const reply = '## TL;DR\nShipped. You need to do 2 things.\n## What you need to do\n### First\n1. Reply `yes`.\n## Done\nTests checked.'
    expect(rules(reply)).toEqual(['headings', 'headings', 'tldr', 'steps'])
    expect(rules('No headings here.', { template: true })).toContain('headings')
  })

  it('every template has the fixed headings in order', () => {
    const dir = new URL('../../.claude/skills/reply-style/templates/', import.meta.url)
    const files = readdirSync(dir)
    expect(files.length).toBeGreaterThanOrEqual(5)
    for (const file of files) {
      const found = [...read(new URL(file, dir)).matchAll(/^## (.+)$/gm)].map((m) => m[1]).filter((h) => HEADINGS.includes(h))
      expect(found, file).toEqual(HEADINGS)
    }
  })
})
