// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

// Guard for central metrics M3 (#449): the collector's workflow runs on its schedule and by hand, on main only,
// with exactly the permissions the plan lists. A new permission or trigger is a change to decide, not a side effect.
const WORKFLOW = readFileSync(new URL('../../.github/workflows/metrics-daily.yml', import.meta.url), 'utf8')

function block(name) {
  const lines = WORKFLOW.split('\n')
  const start = lines.findIndex((l) => l === `${name}:`)
  if (start < 0) return null
  const out = []
  for (const line of lines.slice(start + 1)) {
    if (line !== '' && !/^\s/.test(line)) break
    out.push(line)
  }
  return out
}

describe('metrics-daily workflow (M3)', () => {
  it('runs on a six-hourly schedule with a jittered minute, and by hand', () => {
    expect(WORKFLOW).toMatch(/^on:\n\s+schedule:\n\s+- cron: '17 \*\/6 \* \* \*'\n\s+workflow_dispatch:\s*$/m)
  })

  it('has exactly the permissions of the plan: read on contents, actions, deployments and pull requests, and the OIDC token', () => {
    const perms = Object.fromEntries(
      block('permissions').map((l) => l.trim().split(':').map((s) => s.trim())).filter(([k]) => k),
    )
    expect(perms).toEqual({
      contents: 'read',
      actions: 'read',
      deployments: 'read',
      'pull-requests': 'read',
      'id-token': 'write',
    })
  })

  it('runs one collection at a time and never cancels one in progress', () => {
    expect(WORKFLOW).toMatch(/^concurrency:\n\s+group: metrics-daily\n\s+cancel-in-progress: false\s*$/m)
  })

  it('has a daily job (O5, #336) with its own job-level permissions, on main only, and no secrets', () => {
    expect(WORKFLOW).toMatch(/^ {2}daily:\n/m)
    const daily = WORKFLOW.slice(WORKFLOW.indexOf('\n  daily:\n'), WORKFLOW.indexOf('\n  alerts:\n'))
    expect(daily).toMatch(/^ {4}permissions:\n {6}id-token: write\n {6}contents: read\s*$/m)
    expect(daily).toMatch(/^ {4}if: github\.ref == 'refs\/heads\/main'$/m)
    expect(daily).toMatch(/audience=x-thread-draft-tool-ops-daily-production/)
    expect(daily).toMatch(/\/api\/ops\/metrics-daily/)
    expect(daily).not.toMatch(/secrets\./)
  })

  it('runs only the collector script, with the workflow token as its only secret-like value', () => {
    expect(WORKFLOW).toMatch(/run: node scripts\/ops-emit\.mjs/)
    // O7 (#338): the only secrets are the two Telegram ones, in the `alerts` job, which holds no OIDC token.
    const secrets = [...WORKFLOW.matchAll(/secrets\.(\w+)/g)].map((m) => m[1])
    expect(secrets).toEqual(['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'])
  })

  it('has an alerts job (O7, #338) that sends the new alerts with the metrics kind, with no OIDC token', () => {
    const alerts = WORKFLOW.slice(WORKFLOW.indexOf('\n  alerts:\n'))
    expect(alerts).toMatch(/needs: daily/)
    expect(alerts).toMatch(/^ {4}permissions:\n {6}contents: read\s*$/m)
    expect(alerts).not.toMatch(/id-token/)
    expect(alerts).toMatch(/NOTIFY_KIND: metrics/)
    expect(alerts).toMatch(/ALERTS: \$\{\{ needs\.daily\.outputs\.alerts \}\}/)
    // Values reach the script through the environment, never inside the shell text.
    expect(alerts.match(/\$\{\{[^}]*\}\}/g).every((e) => /^\$\{\{ (needs\.daily\.outputs\.alerts|secrets\.TELEGRAM_\w+) \}\}$/.test(e) || /github\.ref/.test(e))).toBe(true)
  })
})
