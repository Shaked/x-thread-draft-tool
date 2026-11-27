// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

// Guard for task J2 (#461): the weekly janitor stays read-only with minimal permissions.
const W = readFileSync(new URL('../../.github/workflows/janitor-weekly.yml', import.meta.url), 'utf8')
const code = W.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')

describe('weekly janitor workflow', () => {
  it('has minimal permissions: contents read, issues write, nothing else, and no job-level permissions', () => {
    expect(code.match(/^\s*permissions:/gm)).toHaveLength(1)
    expect(code).not.toMatch(/write-all|read-all/)
    const block = code.match(/^permissions:\n((?:[ \t]+.+\n)+)/m)[1].trim().split('\n').map((l) => l.trim())
    expect(block.sort()).toEqual(['contents: read', 'issues: write'])
  })

  it('runs on a weekly schedule and by hand', () => {
    expect(code).toMatch(/^\s*- cron: '\d+ \d+ \* \* \d'$/m)
    expect(code).toMatch(/^\s+workflow_dispatch:/m)
  })

  it('can be turned off (any case), runs on schedule, and a manual run only on the default branch', () => {
    const cond = code.match(/^\s+if: >-\n((?:\s+.+\n)+?)\s+runs-on:/m)[1].replace(/\s+/g, ' ').trim()
    expect(cond).toBe(
      "!contains(fromJSON('[\"off\",\"false\",\"0\"]'), vars.JANITOR_AUTO) && " +
        "(github.event_name == 'schedule' || github.ref == format('refs/heads/{0}', github.event.repository.default_branch))"
    )
  })

  it('pins every action by commit sha', () => {
    const uses = [...code.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1])
    expect(uses.length).toBeGreaterThan(0)
    for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}$/)
  })

  it('only reads (fetch and report) and only comments: no close, label, edit or delete', () => {
    expect(code).toContain('janitor.mjs fetch')
    expect(code).toContain('janitor.mjs report')
    expect(code).toContain('gh issue comment')
    expect(code).not.toMatch(/gh issue (close|edit|delete|reopen)|gh label|gh api\s+-X|--method|issues\/\d+\/labels/)
    expect(code).not.toMatch(/secrets\./)
  })

  it('lints the report before it posts it, and never echoes the token', () => {
    expect(code.indexOf('reply-lint.mjs')).toBeGreaterThan(-1)
    expect(code.indexOf('reply-lint.mjs')).toBeLessThan(code.indexOf('gh issue comment'))
    expect(code).not.toMatch(/echo[^\n]*GH_TOKEN/)
  })
})
