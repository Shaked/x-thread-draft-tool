// @vitest-environment node
// Implements #273 Task C3 (issue #372): the connect guide has the same client setups in English and Hebrew, the same
// steps per client, the Grok steps marked "not checked", and a link between the two files. No network.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const EN = readFileSync(path.resolve('docs/agents/mcp.md'), 'utf8')
const HE = readFileSync(path.resolve('docs/agents/mcp.he.md'), 'utf8')

/** The lines under one "## " heading, up to the next "## " heading. Null when the heading is missing. */
function section(text, heading) {
  const lines = text.split('\n')
  const start = lines.indexOf(heading)
  if (start < 0) return null
  const end = lines.findIndex((line, i) => i > start && line.startsWith('## '))
  return lines.slice(start + 1, end < 0 ? undefined : end)
}

/** The client names of a Setup section: its bold lines, such as **Claude Code**. */
const clients = (lines) => lines.map((line) => line.match(/^\*\*(.+)\*\*$/)?.[1]).filter(Boolean)

/** The numbered steps of each client, in order: the step lines under each bold client line. */
function stepsByClient(lines) {
  const out = {}
  let current = null
  for (const line of lines) {
    const name = line.match(/^\*\*(.+)\*\*$/)?.[1]
    if (name) current = (out[name] = [])
    else if (current && /^\d+\. /.test(line)) current.push(line)
  }
  return out
}

const EN_SETUP = section(EN, '## Setup')
const HE_SETUP = section(HE, '## הגדרה')

describe('connect guide (docs/agents/mcp.md and mcp.he.md)', () => {
  it('has the same clients, in the same order, in the English and the Hebrew Setup', () => {
    expect(EN_SETUP).not.toBeNull()
    expect(HE_SETUP).not.toBeNull()
    expect(clients(EN_SETUP)).toEqual(['Claude (web, desktop, mobile)', 'Claude Code', 'Codex CLI', 'ChatGPT', 'Grok'])
    expect(clients(HE_SETUP)).toEqual(clients(EN_SETUP))
  })

  it('has the same number of numbered steps for every client', () => {
    const en = stepsByClient(EN_SETUP)
    const he = stepsByClient(HE_SETUP)
    for (const name of clients(EN_SETUP)) {
      expect({ client: name, steps: he[name]?.length ?? 0 }).toEqual({ client: name, steps: en[name].length })
      expect(en[name].length).toBeGreaterThan(0)
    }
  })

  it('writes every Hebrew step in Hebrew', () => {
    for (const steps of Object.values(stepsByClient(HE_SETUP))) {
      for (const step of steps) expect(step).toMatch(/[֐-׿]/)
    }
  })

  it('marks the Grok steps "not checked" in both languages', () => {
    expect(EN_SETUP.join('\n')).toMatch(/Not checked: these steps were not read/)
    expect(HE_SETUP.join('\n')).toMatch(/לא נבדק: השלבים של Grok/)
  })

  it('links each file to the other, at the top of the English file and in the Hebrew file', () => {
    expect(EN.split('\n').slice(0, 5).join('\n')).toContain('](./mcp.he.md)')
    expect(HE).toContain('](./mcp.md)')
  })

  it('has the Hebrew disconnect and troubleshooting sections', () => {
    expect(section(HE, '## ניתוק')).not.toBeNull()
    expect(section(HE, '## פתרון תקלות')).not.toBeNull()
  })
})
