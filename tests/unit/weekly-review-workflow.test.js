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

  it('has exactly the permissions it needs: read the code and the speed data (task S7, #315), write issues, nothing else', () => {
    const block = /^permissions:\n((?:\s{2}.*\n?)+)/m.exec(WORKFLOW)
    expect(block).not.toBeNull()
    const perms = block[1]
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .sort()
    // actions, pull-requests and deployments: read-only, for `gh run download` and scripts/speed-metrics.mjs (S7).
    expect(perms).toEqual(['actions: read', 'contents: read', 'deployments: read', 'issues: write', 'pull-requests: read'])
  })

  it('the speed step gets no Telegram secret, so it can never send a message', () => {
    const lines = WORKFLOW.split('\n')
    const at = lines.findIndex((l) => /name: Measure the speed of the last 7 days/.test(l))
    expect(at).toBeGreaterThan(-1)
    const end = lines.findIndex((l, i) => i > at && /^\s{6}- name:/.test(l))
    const step = lines.slice(at, end)
    expect(step.join('\n')).not.toMatch(/secrets\./)
    expect(step.some((l) => /^\s+continue-on-error:\s*true\s*$/.test(l))).toBe(true)
  })

  it('the speed metrics are measured for the last 7 days, with the previous week when the artifact exists', () => {
    expect(WORKFLOW).toMatch(/--since 7d --out speed-metrics/)
    expect(WORKFLOW).toMatch(/--previous "\$RUNNER_TMP_DIR\/previous-speed\/speed\.json"/)
    expect(WORKFLOW).toMatch(/name: speed-metrics-weekly/)
  })

  it('the baseline is a successful run on the default branch only, and a dry run never uploads one', () => {
    expect(WORKFLOW).toMatch(/gh run list[^\n]*--branch "\$DEFAULT_BRANCH"[^\n]*--status success/)
    expect(WORKFLOW).toMatch(/DEFAULT_BRANCH: \$\{\{ github\.event\.repository\.default_branch \}\}/)
    const lines = WORKFLOW.split('\n')
    const at = lines.findIndex((l) => /name: Upload the speed metrics of the week/.test(l))
    expect(lines.slice(at, at + 4).join('\n')).toMatch(/if: inputs\.dry_run != true/)
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

  it('the Telegram step never fails the job, structurally (continue-on-error on that step)', () => {
    const lines = WORKFLOW.split('\n')
    const at = lines.findIndex((l) => /name: "Telegram: one line about the new issue"/.test(l))
    expect(at).toBeGreaterThan(-1)
    const step = lines.slice(at, at + 8)
    expect(step.some((l) => /^\s+continue-on-error:\s*true\s*$/.test(l))).toBe(true)
  })
})
