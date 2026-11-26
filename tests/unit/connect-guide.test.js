// @vitest-environment node
// Implements #273 Task C3 (issue #372): the connect guide has the same client setups in English and Hebrew: the same
// clients in the same order, the same steps (commands, code spans and connector address), the Grok caveat under the
// Grok steps in both languages, and a link between the two files. No network.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const EN = readFileSync(path.resolve('docs/agents/mcp.md'), 'utf8')
const HE = readFileSync(path.resolve('docs/agents/mcp.he.md'), 'utf8')
const CONNECTOR = 'https://x-thread-draft-tool.vercel.app/api/mcp'

/** The lines under one "## " heading, up to the next "## " heading. Null when the heading is missing. */
function section(text, heading) {
  const lines = text.split('\n')
  const start = lines.indexOf(heading)
  if (start < 0) return null
  const end = lines.findIndex((line, i) => i > start && line.startsWith('## '))
  return lines.slice(start + 1, end < 0 ? undefined : end)
}

/** The client name of a bold line such as **Claude Code**, or null. */
const clientName = (line) => line.match(/^\*\*(.+)\*\*$/)?.[1] ?? null

/** Client names of a Setup section, in order. */
const clients = (lines) => lines.map(clientName).filter(Boolean)

/** Per client: its numbered step lines, in order. */
function stepsByClient(lines) {
  const out = {}
  let current = null
  for (const line of lines) {
    const name = clientName(line)
    if (name) current = (out[name] = [])
    else if (current && /^\d+\. /.test(line)) current.push(line)
  }
  return out
}

/** The code spans of a line, in order: `claude mcp add ...`. */
const codeSpans = (line) => [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1])

const EN_SETUP = section(EN, '## Setup')
const HE_SETUP = section(HE, '## הגדרה')

describe('connect guide (docs/agents/mcp.md and mcp.he.md)', () => {
  it('has the same clients, in the same order, in the English and the Hebrew Setup', () => {
    expect(EN_SETUP).not.toBeNull()
    expect(HE_SETUP).not.toBeNull()
    expect(clients(EN_SETUP)).toEqual(['Claude (web, desktop, mobile)', 'Claude Code', 'Codex CLI', 'ChatGPT', 'Grok'])
    expect(clients(HE_SETUP)).toEqual(clients(EN_SETUP))
  })

  it('has the same steps for every client: the same count and the same code spans in each step', () => {
    const en = stepsByClient(EN_SETUP)
    const he = stepsByClient(HE_SETUP)
    for (const name of clients(EN_SETUP)) {
      expect(en[name].length, `${name} has steps`).toBeGreaterThan(0)
      expect(he[name]?.length ?? 0, `${name} step count`).toBe(en[name].length)
      en[name].forEach((step, i) => {
        expect({ client: name, step: i + 1, spans: codeSpans(he[name][i]) }).toEqual({
          client: name,
          step: i + 1,
          spans: codeSpans(step)
        })
      })
    }
  })

  it('writes every Hebrew step in Hebrew', () => {
    for (const steps of Object.values(stepsByClient(HE_SETUP))) {
      for (const step of steps) expect(step).toMatch(/[֐-׿]/)
    }
  })

  it('gives the connector address in both files', () => {
    expect(EN).toContain(CONNECTOR)
    expect(HE).toContain(CONNECTOR)
  })

  it('puts the "not checked" caveat after the Grok steps, in both languages', () => {
    const enGrok = EN_SETUP.slice(EN_SETUP.indexOf('**Grok**'))
    const heGrok = HE_SETUP.slice(HE_SETUP.indexOf('**Grok**'))
    expect(enGrok.join('\n')).toMatch(/^Not checked: these steps were not read from xAI's documentation\./m)
    expect(heGrok.join('\n')).toMatch(/^לא נבדק: השלבים של Grok לא נקראו מהתיעוד של xAI\./m)
    expect(enGrok.findIndex((line) => /^\d+\. /.test(line))).toBeLessThan(enGrok.findIndex((line) => line.startsWith('Not checked:')))
    expect(heGrok.findIndex((line) => /^\d+\. /.test(line))).toBeLessThan(heGrok.findIndex((line) => line.startsWith('לא נבדק:')))
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
