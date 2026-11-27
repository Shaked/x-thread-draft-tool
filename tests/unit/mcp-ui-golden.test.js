// T18 (#292): the HTML of each MCP view is pinned for one fixed Blob origin and for none. A refactor of the view code
// must leave these files as they are; a change that must alter them regenerates them with UPDATE_GOLDEN=1 and says why in the PR.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { THREAD_VIEW } from '../../server/mcp/ui/thread.js'
import { DRAFTS_VIEW } from '../../server/mcp/ui/drafts.js'
import { SHARE_VIEW } from '../../server/mcp/ui/share.js'

const DIR = join(process.cwd(), 'tests/unit/fixtures/mcp-ui-golden')
const ORIGINS = { blob: 'https://abc123def.public.blob.vercel-storage.com', none: null }

describe('golden view HTML', () => {
  for (const view of [THREAD_VIEW, DRAFTS_VIEW, SHARE_VIEW]) {
    for (const [label, origin] of Object.entries(ORIGINS)) {
      it(`${view.name} view with origin ${label} matches its golden file`, () => {
        const file = join(DIR, `${view.name}-${label}.html`)
        const html = view.html(origin)
        if (process.env.UPDATE_GOLDEN === '1') {
          mkdirSync(DIR, { recursive: true })
          writeFileSync(file, html)
        }
        expect(existsSync(file), `${file} exists`).toBe(true)
        expect(html).toBe(readFileSync(file, 'utf8'))
      })
    }
  }
})
