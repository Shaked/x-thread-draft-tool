// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

// Guard for task C4 (#269): the cleanup review runs on demand only. A schedule trigger must not
// come back by accident; the change has to be decided and recorded in docs/operations/cleanup-review.md.
const WORKFLOW = readFileSync(new URL('../../.github/workflows/cleanup-review-daily.yml', import.meta.url), 'utf8')

describe('cleanup review workflow runs on demand only', () => {
  it('has no schedule trigger and no cron line', () => {
    expect(WORKFLOW).not.toMatch(/^\s*schedule:/m)
    expect(WORKFLOW).not.toMatch(/^\s*-\s*cron:/m)
  })

  it('can be started by hand, and a hand-started run does the real thing by default', () => {
    expect(WORKFLOW).toMatch(/^on:\n\s+workflow_dispatch:/m)
    expect(WORKFLOW).toMatch(/^\s+dry_run:\n(?:\s+.*\n)*?\s+default: false\n/m)
  })
})
