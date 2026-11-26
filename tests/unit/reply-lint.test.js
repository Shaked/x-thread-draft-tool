// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HEADINGS, lint } from '../../scripts/reply-lint.mjs'

// bad-*.md are three real replies of 2026-11-21 (task #353); good-*.md are the validator's rewrites.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const fixture = (name) => read(`./fixtures/reply-lint/${name}.md`)
const rules = (text, options) => lint(text, options).map((f) => f.rule)
const templates = (name) => read(`../../.claude/reply-style-templates/${name}`)
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
    const dirs = [new URL('../../plugins/reply-style/skills/reply-style/templates/', import.meta.url), new URL('../../.claude/reply-style-templates/', import.meta.url)]
    const files = dirs.flatMap((dir) => readdirSync(dir).filter((f) => !OTHER_KINDS.includes(f)).map((f) => new URL(f, dir)))
    expect(files.length).toBeGreaterThanOrEqual(7)
    for (const file of files) {
      const found = [...read(file).matchAll(/^## (.+)$/gm)].map((m) => m[1]).filter((h) => HEADINGS.includes(h))
      expect(found, file.pathname).toEqual(HEADINGS)
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

describe('session-link rule edge cases (Opus review of #523)', () => {
  const reply = (waiting) => `## TL;DR\nA task ran.\nNothing needed from you.\n\n## What you need to do\nNothing.\n\n## Waiting for\n${waiting}\n\n## Blocked on you\nNothing.\n\n## Done\n- Checked.\n`
  const found = (waiting) => lint(reply(waiting), { template: true }).filter((f) => f.rule === 'session-link')
  const task = '[#5 tag filter issue](https://example.com/issues/5)'

  it('a title with the word "session" inside a link is not a session', () => {
    expect(found(`- [#5 session janitor misses claims](https://example.com/issues/5): CI runs. Expected: not known.`)).toEqual([])
  })
  it('accepts a session link with a query, and a sub-bullet under an item that has its link', () => {
    expect(found(`- ${task} · [session](https://claude.ai/code/session_01AbC?tab=x): works. Expected: not known.\n  - its session waits for CI`)).toEqual([])
  })
  it('reports the line of the bad item, not the heading', () => {
    const [f] = found(`- ${task} · [session](https://claude.ai/code/session_a): works.\n- ${task}: the session works on it.`)
    expect(f.line).toBe(10)
  })
})

describe('session-link rule: a link that says session must have the session address (Opus re-review of #523)', () => {
  const reply = (item) => `## TL;DR\nA task ran.\nNothing needed from you.\n\n## What you need to do\nNothing.\n\n## Waiting for\n${item}\n\n## Blocked on you\nNothing.\n\n## Done\n- Checked.\n`
  const task = '[#5 tag filter issue](https://example.com/issues/5)'
  it.each([
    'https://claude.ai/code/01abc',
    'https://github.com/o/r/issues/5',
    'https://claude.ai/chat/session_01A'
  ])('flags [session](%s)', (url) => {
    expect(lint(reply(`- ${task} · [session](${url}): works.`), { template: true }).map((f) => f.rule)).toContain('session-link')
  })
  it('flags a session id as link text that points elsewhere', () => {
    expect(lint(reply(`- ${task} · [\`session_01abc\`](https://example.com): works.`), { template: true }).map((f) => f.rule)).toContain('session-link')
  })
  it('passes the right session link', () => {
    expect(lint(reply(`- ${task} · [session](https://claude.ai/code/session_01abc): works.`), { template: true }).map((f) => f.rule)).not.toContain('session-link')
  })
})

describe('scripts/reply-lint.mjs wrapper (the plugin lint with this repo config)', () => {
  const SCRIPT = fileURLToPath(new URL('../../scripts/reply-lint.mjs', import.meta.url))
  const BAD = fileURLToPath(new URL('./fixtures/reply-lint/golden/status-report/bad-loose-label.md', import.meta.url))
  const GOOD = fileURLToPath(new URL('./fixtures/reply-lint/golden/status-report/good-1.md', import.meta.url))

  it('exits 1 with the findings on a bad reply, and 0 on a good one', () => {
    const bad = spawnSync('node', [SCRIPT, '--template', BAD], { encoding: 'utf8' })
    expect(bad.status).toBe(1)
    expect(bad.stdout).toContain('loose-label')
    expect(spawnSync('node', [SCRIPT, '--template', GOOD], { encoding: 'utf8' }).status).toBe(0)
  })

  it('applies this repo config: "Blocked on Shaked" passes, as before the plugin', () => {
    expect(rules('Blocked on Shaked for the review.')).toEqual([])
  })

  it('lets --config override the repo file (a missing one exits 2)', () => {
    const run = spawnSync('node', [SCRIPT, '--config', '/nonexistent/agent-kit.json', GOOD], { encoding: 'utf8' })
    expect(run.status).toBe(2)
  })
})

describe('wrapper edge cases (Opus review of PR 530)', () => {
  it('works from a checkout path with a space', () => {
    const dir = mkdtempSync(join(tmpdir(), 'repo copy '))
    cpSync(new URL('../../scripts', import.meta.url), join(dir, 'scripts'), { recursive: true })
    cpSync(new URL('../../plugins', import.meta.url), join(dir, 'plugins'), { recursive: true })
    cpSync(new URL('../../.claude/agent-kit.json', import.meta.url), join(dir, '.claude', 'agent-kit.json'))
    const run = spawnSync('node', [join(dir, 'scripts', 'reply-lint.mjs')], { input: 'Blocked on Shaked\n', encoding: 'utf8' })
    expect(run.status).toBe(0)
    rmSync(dir, { recursive: true, force: true })
  })

  it('a broken settings file exits 2 with a message, not a stack trace', () => {
    const dir = mkdtempSync(join(tmpdir(), 'repo-'))
    cpSync(new URL('../../scripts', import.meta.url), join(dir, 'scripts'), { recursive: true })
    cpSync(new URL('../../plugins', import.meta.url), join(dir, 'plugins'), { recursive: true })
    mkdirSync(join(dir, '.claude'))
    writeFileSync(join(dir, '.claude', 'agent-kit.json'), '{bad')
    const run = spawnSync('node', [join(dir, 'scripts', 'reply-lint.mjs')], { input: 'x\n', encoding: 'utf8' })
    expect(run.status).toBe(2)
    expect(run.stderr).not.toMatch(/^\s+at /m)
    const hook = spawnSync('node', [join(dir, 'scripts', 'reply-style-stop.mjs')], { input: JSON.stringify({ last_assistant_message: 'x' }), env: { PATH: process.env.PATH, REPLY_STYLE: 'owner' }, encoding: 'utf8' })
    expect(hook.status).toBe(0)
    rmSync(dir, { recursive: true, force: true })
  })

  it('an allowed Implements line still gets the option-letters and long-line checks', () => {
    const line = `Implements #273 Task R0 ${'word '.repeat(40)} A or B`
    expect(rules(line)).toEqual(expect.arrayContaining(['option-letters', 'long-line']))
  })

  it('--config with no path exits 2', () => {
    const SCRIPT = fileURLToPath(new URL('../../scripts/reply-lint.mjs', import.meta.url))
    expect(spawnSync('node', [SCRIPT, '--config'], { input: 'x', encoding: 'utf8' }).status).toBe(2)
  })
})

describe('comment lint wrapper with a broken settings file', () => {
  it('skips a human comment (exit 0) and reports an agent comment with exit 2, no stack trace', () => {
    const dir = mkdtempSync(join(tmpdir(), 'repo-'))
    cpSync(new URL('../../scripts', import.meta.url), join(dir, 'scripts'), { recursive: true })
    cpSync(new URL('../../plugins', import.meta.url), join(dir, 'plugins'), { recursive: true })
    mkdirSync(join(dir, '.claude'))
    writeFileSync(join(dir, '.claude', 'agent-kit.json'), '{bad')
    const run = (body) => spawnSync('node', [join(dir, 'scripts', 'reply-lint-comment.mjs')], { env: { PATH: process.env.PATH, COMMENT_BODY: body }, encoding: 'utf8' })
    expect(run('just a human comment').status).toBe(0)
    const agent = run('HANDOFF #1 (x) - done\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_\n')
    expect(agent.status).toBe(2)
    expect(agent.stderr).not.toMatch(/^\s+at /m)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('skill links', () => {
  it('every relative markdown link in a project skill points at a file that exists', () => {
    const skills = new URL('../../.claude/skills/', import.meta.url)
    for (const d of readdirSync(skills, { withFileTypes: true })) {
      if (!d.isDirectory() && !d.isSymbolicLink()) continue
      const file = new URL(`${d.name}/SKILL.md`, skills)
      let text
      try { text = readFileSync(file, 'utf8') } catch { continue }
      for (const m of text.matchAll(/\]\((?!https?:|#|mailto:)([^)\s#]+)(?:#[^)]*)?\)/g)) {
        expect(existsSync(new URL(m[1], file)), `${d.name}/SKILL.md links to ${m[1]}`).toBe(true)
      }
    }
  })
})
