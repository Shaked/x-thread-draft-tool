// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

// Task S5 (#310): the speed workflow only reads. Its permissions are exact, it keeps no credentials,
// and it never puts a commit or pull request title into shell text.
const WORKFLOW = readFileSync(new URL('../../.github/workflows/speed-metrics.yml', import.meta.url), 'utf8')

describe('speed metrics workflow', () => {
  it('runs after the production smoke test and on demand, nothing else', () => {
    expect(WORKFLOW).toMatch(/^on:\n\s+workflow_dispatch:/m)
    expect(WORKFLOW).toMatch(/workflow_run:\n\s+workflows: \['Smoke test \(deployed\)'\]\n\s+types: \[completed\]/)
    expect(WORKFLOW).not.toMatch(/^\s*schedule:/m)
    expect(WORKFLOW).not.toMatch(/^\s*-\s*cron:/m)
  })

  it('has exactly the read permissions of the plan, and no write scope', () => {
    expect(WORKFLOW).toMatch(/^permissions:\n\s+contents: read\n\s+actions: read\n\s+pull-requests: read\n\s+deployments: read\n/m)
    expect(WORKFLOW).not.toMatch(/write/)
    expect(WORKFLOW).not.toMatch(/id-token/)
  })

  it('does not keep the checkout credentials', () => {
    expect(WORKFLOW).toMatch(/persist-credentials: false/)
  })

  it('reads commit and pull request titles nowhere in shell text', () => {
    expect(WORKFLOW).not.toMatch(/head_commit\.message|head_commit\.author|pull_request\.title|\.title\b/)
  })

  it('skips a cancelled smoke run, and installs no packages', () => {
    expect(WORKFLOW).toMatch(/github\.event\.workflow_run\.conclusion != 'cancelled'/)
    // Comments may say "no npm ci"; only the commands count.
    const commands = WORKFLOW.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
    expect(commands).not.toMatch(/npm ci|npm install/)
  })
})
