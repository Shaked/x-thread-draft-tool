import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
// IconButton has no page yet. Importing it here keeps knip from calling the file unused (plan section 3, first user).
import IconButton from '../../src/ui/IconButton.jsx'

// Component list (plan section 6, item 4): every file in src/ui/ has one section in docs/architecture/ui-components.md,
// with a status (built, or not built with a reason of at least 3 words), a props table and an example.
// Reads each file once. Pure text checks, well under 300 ms.

const UI_DIR = 'src/ui'
const DOC = 'docs/architecture/ui-components.md'

const components = readdirSync(UI_DIR)
  .filter((file) => file.endsWith('.jsx'))
  .map((file) => path.basename(file, '.jsx'))
  .sort()

const doc = readFileSync(DOC, 'utf8')
// Each "## Name" starts a section; the text after the heading is its body.
const sections = new Map(
  doc.split(/^## /m).slice(1).map((chunk) => {
    const [heading, ...body] = chunk.split('\n')
    return [heading.trim(), body.join('\n')]
  })
)

describe('UI component list', () => {
  it('has one section for every file in src/ui and no section for a file that is not there', () => {
    expect([...sections.keys()].sort()).toEqual(components)
  })

  it.each(components)('%s has a status, a props table and an example', (name) => {
    const body = sections.get(name) ?? ''
    const status = body.match(/^- Status: (.+)$/m)?.[1] ?? ''
    if (status.startsWith('built')) {
      expect(components).toContain(name)
    } else {
      const reason = status.match(/^not built: (.+)$/)?.[1] ?? ''
      expect(reason.split(/\s+/).length, `${name} needs a reason`).toBeGreaterThanOrEqual(3)
    }
    expect(body, `${name} props table`).toMatch(/^\| Prop \|/m)
    expect(body, `${name} example`).toMatch(/^- Example: `</m)
  })

  it('exports a component for the file that has no page yet', () => {
    expect(typeof IconButton).toBe('function')
  })
})
