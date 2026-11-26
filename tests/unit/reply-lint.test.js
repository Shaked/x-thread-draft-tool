// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HEADINGS, lint } from '../../scripts/reply-lint.mjs'

// bad-*.md are three real replies of 2026-11-21 (task #353); good-*.md are the validator's rewrites.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const fixture = (name) => read(`./fixtures/reply-lint/${name}.md`)
const rules = (text, options) => lint(text, options).map((f) => f.rule)
const templates = (name) => read(`../../.claude/skills/reply-style/templates/${name}`)
const OTHER_KINDS = ['changelog-entry.md', 'telegram-message.md']

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
    expect(rules('Implements #273 Task R0')).toEqual([])
    expect(rules('Done ✅. Let us delve in.')).toEqual(['emoji', 'slop'])
    expect(rules('x'.repeat(161))).toEqual(['long-line'])
  })

  it('checks the template headings, the TL;DR and the step count', () => {
    const reply = '## TL;DR\nShipped. You need to do 2 things.\n## What you need to do\n### First\n1. Reply `yes`.\n## Done\nTests checked.'
    expect(rules(reply)).toEqual(['headings', 'headings', 'tldr', 'steps'])
    expect(rules('No headings here.', { template: true })).toContain('headings')
  })

  it('every reply template has the fixed headings in order', () => {
    const dir = new URL('../../.claude/skills/reply-style/templates/', import.meta.url)
    const files = readdirSync(dir).filter((f) => !OTHER_KINDS.includes(f))
    expect(files.length).toBeGreaterThanOrEqual(5)
    for (const file of files) {
      const found = [...read(new URL(file, dir)).matchAll(/^## (.+)$/gm)].map((m) => m[1]).filter((h) => HEADINGS.includes(h))
      expect(found, file).toEqual(HEADINGS)
    }
  })

  it('checks changelog entries and Telegram messages by their own shape', () => {
    // The template with its two placeholders filled in passes; the other placeholders are plain text.
    const filled = templates('changelog-entry.md')
      .replace('Area: <one word from the Area list in docs/operations/changelog.md>', 'Area: Docs')
      .replace('Link: <the pull request address, starting with https://>', 'Link: https://x.test/pull/1')
    expect(lint(filled, { kind: 'changelog' })).toEqual([])
    expect(rules('# Faster saves\n- Fixed in #359 and `server/x.js`.', { kind: 'changelog' })).toEqual(['shape', 'shape', 'internal-label'])
    expect(rules('- No title line.', { kind: 'changelog' })).toEqual(['shape', 'shape', 'shape', 'shape'])
  })

  it('checks the changelog Area and Link lines, and skips the Technical details part', () => {
    const entry = (area, link, extra = '') => `# Faster saves\n- A draft opens sooner.\n\nArea: ${area}\nLink: ${link}\n${extra}`
    expect(rules(entry('Speed', 'https://x.test/pull/2'), { kind: 'changelog' })).toEqual([])
    expect(rules(entry('Billing', 'https://x.test/pull/2'), { kind: 'changelog' })).toEqual(['shape'])
    expect(rules(entry('Speed', 'http://x.test/pull/2'), { kind: 'changelog' })).toEqual(['shape'])
    expect(rules('# Faster saves\n- A draft opens sooner.\nArea: Speed\nLink: https://x.test/pull/2\nArea: Docs\n', { kind: 'changelog' })).toEqual(['shape'])
    // Labels and code below the heading are not checked.
    expect(rules(entry('Speed', 'https://x.test/pull/2', '\n## Technical details\n\nFixed T7 in `server/x.js`.\n'), { kind: 'changelog' })).toEqual([])
    // Every example message in the template (six kinds, eight forms, the speed alert among them) passes the Telegram lint.
    const examples = [...templates('telegram-message.md').matchAll(/^Example:\n```text\n([\s\S]*?)```$/gm)].map((m) => m[1])
    expect(examples).toHaveLength(8)
    for (const message of examples) {
      expect(lint(message, { kind: 'telegram', app: 'Thread Draft' }), message).toEqual([])
    }
    expect(rules('Production is live\n[Open](https://x.test)', { kind: 'telegram' })).toEqual(['app-name'])
    // #463: the headline needs its emoji, and a "nothing" section is flagged.
    expect(rules('**Thread Draft** · [Production is live](https://x.test)\nT', { kind: 'telegram' })).toEqual(['shape'])
    expect(rules('✅ **Thread Draft** · [Production is live](https://x.test)\nT\nNothing needed.', { kind: 'telegram' })).toEqual(['empty-section'])
    expect(rules('✅ **Thread Draft** · [Production is live](https://x.test)\nT 🎉', { kind: 'telegram' })).toEqual(['emoji'])
    // #504: a message without the app name fails, and --app requires that exact name.
    expect(rules('✅ **[Production is live](https://x.test)**\nT', { kind: 'telegram' })).toEqual(['app-name'])
    expect(rules('✅ **Production is live**\nT', { kind: 'telegram' })).toEqual(['app-name'])
    expect(rules('✅ [Production is live](https://x.test)\nT', { kind: 'telegram' })).toEqual(['app-name'])
    expect(rules('✅ **Thread Draft** ·\nT', { kind: 'telegram' })).toEqual(['app-name'])
    expect(rules('✅ **Thread Draft** · [Live](https://x.test)\nT', { kind: 'telegram', app: 'Thread Draft' })).toEqual([])
    expect(rules('✅ **Thread Draft** · [Live](https://x.test)\nT', { kind: 'telegram', app: 'Recipe Box' })).toEqual(['app-name'])
    // A real title that starts with "None" or "Nothing" is not an empty section.
    for (const title of ['None of the drafts are lost on reload', 'Nothing breaks when offline', 'Nothing lost after reload']) {
      expect(rules(`🙋 **Thread Draft** · [An issue needs you](https://x.test)\n${title}`, { kind: 'telegram' }), title).toEqual([])
    }
    // The headline is the first prose line, even after a fenced block.
    expect(rules('```\nx\n```\n✅ **Thread Draft** · [P](https://x.test)\nT', { kind: 'telegram' })).toEqual([])
  })
})
