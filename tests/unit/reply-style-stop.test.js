// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decide } from '../../scripts/reply-style-stop.mjs'

const golden = (p) => readFileSync(new URL(`./fixtures/reply-lint/golden/${p}`, import.meta.url), 'utf8')
const OWNER = { REPLY_STYLE: 'owner' }
const SCRIPT = new URL('../../scripts/reply-style-stop.mjs', import.meta.url).pathname

describe('reply-style Stop hook (no model)', () => {
  it('lets a good reply end the turn', () => {
    expect(decide({ last_assistant_message: golden('status-report/good-1.md') }, OWNER)).toBeNull()
  })

  it('blocks a reply with loose bold labels and lists the failing rules', () => {
    const out = decide({ last_assistant_message: golden('status-report/bad-loose-label.md') }, OWNER)
    expect(out.decision).toBe('block')
    expect(out.reason).toContain('loose-label')
    expect(out.reason).toContain('headings')
  })

  it('covers the session-link rule: a Waiting for session without its link is sent back, with the link it passes', () => {
    const out = decide({ last_assistant_message: golden('handoff/bad-session-link.md') }, OWNER)
    expect(out.decision).toBe('block')
    expect(out.reason).toContain('session-link')
    expect(decide({ last_assistant_message: golden('handoff/good-2.md') }, OWNER)).toBeNull()
  })

  it('does not check sessions that did not opt in, or a second pass, or an empty message', () => {
    const bad = { last_assistant_message: golden('status-report/bad-loose-label.md') }
    expect(decide(bad, {})).toBeNull()
    expect(decide(bad, { REPLY_STYLE: 'other' })).toBeNull()
    expect(decide({ ...bad, stop_hook_active: true }, OWNER)).toBeNull()
    expect(decide({ last_assistant_message: '  ' }, OWNER)).toBeNull()
    expect(decide(null, OWNER)).toBeNull()
  })

  it('works as a process: JSON on stdin, JSON on stdout, exit 0', () => {
    const run = (message, env) => execFileSync('node', [SCRIPT], {
      input: JSON.stringify({ last_assistant_message: message, stop_hook_active: false }),
      env: { PATH: process.env.PATH, ...env }, encoding: 'utf8'
    })
    expect(run(golden('handoff/good-1.md'), OWNER)).toBe('')
    expect(JSON.parse(run(golden('handoff/bad-loose-label.md'), OWNER)).decision).toBe('block')
    expect(run(golden('handoff/bad-loose-label.md'), {})).toBe('')
  })

  it('registers the Stop hook in .claude/settings.json', () => {
    const settings = JSON.parse(readFileSync(new URL('../../.claude/settings.json', import.meta.url), 'utf8'))
    expect(settings.hooks.Stop[0].hooks[0].command).toContain('scripts/reply-style-stop.mjs')
  })
})
