// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

// Guard for task #295: the weekly review runs on a schedule and by hand, with only the permissions and
// secrets it needs. A change to any of these has to be decided and recorded in docs/operations/weekly-review.md.
const WORKFLOW = readFileSync(new URL('../../.github/workflows/weekly-review.yml', import.meta.url), 'utf8')

describe('weekly review workflow', () => {
  it('runs on a weekly schedule, at a minute other than 0', () => {
    expect(WORKFLOW).toMatch(/^on:\n\s+schedule:\n\s+-\s+cron:\s+'(\d+) 5 \* \* 1'/m)
    const minute = Number(/cron:\s+'(\d+) /.exec(WORKFLOW)[1])
    expect(minute).not.toBe(0)
  })

  it('can be started by hand, and a hand-started run does the real thing by default', () => {
    expect(WORKFLOW).toMatch(/^\s+workflow_dispatch:/m)
    const lines = WORKFLOW.split('\n')
    const at = lines.findIndex((l) => /^\s+dry_run:\s*$/.test(l))
    expect(at).toBeGreaterThan(-1)
    expect(lines.slice(at + 1, at + 6).some((l) => /^\s+default: false$/.test(l))).toBe(true)
  })

  it('has exactly the permissions it needs: read the code, write issues, nothing else', () => {
    const block = /^permissions:\n((?:\s{2}.*\n?)+)/m.exec(WORKFLOW)
    expect(block).not.toBeNull()
    const perms = block[1]
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .sort()
    expect(perms).toEqual(['contents: read', 'issues: write'])
  })

  it('never keeps the checkout token in .git', () => {
    expect(WORKFLOW).toMatch(/persist-credentials:\s*false/)
  })

  it('uses only the two Telegram secrets', () => {
    const used = [...new Set([...WORKFLOW.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]))].sort()
    expect(used).toEqual(['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'])
  })

  it('writes only on the default branch, and the issue carries the task and weekly labels', () => {
    expect(WORKFLOW).toMatch(/github\.ref == format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)/)
    expect(WORKFLOW).toMatch(/--label task --label weekly/)
  })

  it('the Telegram step never fails the job', () => {
    expect(WORKFLOW).toMatch(/notify-telegram|weekly-review-check\.mjs notify/)
    expect(WORKFLOW).not.toMatch(/TELEGRAM[^\n]*exit 1/)
  })
})
