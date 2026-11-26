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

  it('runs only the collector script, with the workflow token as its only secret-like value', () => {
    expect(WORKFLOW).toMatch(/run: node scripts\/ops-emit\.mjs/)
    expect(WORKFLOW).not.toMatch(/secrets\./)
  })
})
