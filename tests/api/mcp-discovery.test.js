// @vitest-environment node
// Implements #273 Task 4 (issue #278): the offline discovery score (tests/eval/discovery/score.mjs) must not fall
// below the recorded baseline. No database, no network, no model. Runs in well under 2 s.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { listTools } from '../../server/mcp/tools.js'
import { listAdminTools } from '../../server/mcp/admin-tools.js'
import { listPrompts } from '../../server/mcp/prompts.js'
import { INSTRUCTIONS } from '../../server/mcp/server.js'
import { WRITE_TOOLS } from '../eval/mcp-default-use.eval.mjs'
import { MODES, NAMES_CONNECTOR, checkAgainst, evaluate, formatTable } from '../eval/discovery/score.mjs'

const dir = new URL('../eval/discovery/', import.meta.url)
const read = (name) => JSON.parse(readFileSync(new URL(name, dir), 'utf8'))
const { intents, negatives } = read('intents.json')
const baseline = read('baseline.json')
const clients = read('clients.json')
const tools = listTools()
const toolNames = new Set(tools.map((t) => t.name))
const URL_RE = /^https:\/\/\S+$/

describe('discovery corpus', () => {
  it('has 13 intents, each with at least 4 English and 4 Hebrew phrases', () => {
    expect(intents).toHaveLength(13)
    for (const intent of intents) {
      for (const lang of ['en', 'he']) {
        expect(intent.phrases.filter((p) => p.lang === lang).length, `${intent.id} ${lang}`).toBeGreaterThanOrEqual(4)
      }
    }
  })

  it('has at least 2 phrases per language per intent that name neither X, Twitter, the connector nor a draft', () => {
    for (const intent of intents) {
      for (const lang of ['en', 'he']) {
        const plain = intent.phrases.filter((p) => p.lang === lang && !NAMES_CONNECTOR.test(p.text))
        expect(plain.length, `${intent.id} ${lang}`).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it('gives every positive phrase expected tools that exist in the real tool list', () => {
    for (const intent of intents) {
      for (const p of intent.phrases) {
        expect(p.expect.length, p.text).toBeGreaterThan(0)
        for (const name of p.expect) expect(toolNames.has(name), `${name} in "${p.text}"`).toBe(true)
      }
    }
  })

  it('has 6 negatives per language, and no negative phrase is a save request', () => {
    for (const lang of ['en', 'he']) expect(negatives.filter((n) => n.lang === lang)).toHaveLength(6)
    for (const n of negatives) expect(n.text).not.toMatch(/write|draft|כתוב|טיוטה|תכתוב/i)
  })

  it('has no duplicate phrase text', () => {
    const texts = [...intents.flatMap((i) => i.phrases.map((p) => p.text)), ...negatives.map((n) => n.text)]
    expect(new Set(texts).size).toBe(texts.length)
  })
})

describe('client profiles', () => {
  const FIELDS = ['reads_instructions', 'shows_prompts', 'reads_resources', 'renders_ui_views', 'reads_tool_title']

  it('lists the six clients, each with every field, a value and a source', () => {
    expect(Object.keys(clients.clients).sort()).toEqual(['chatgpt', 'claude_ai', 'claude_code', 'claude_desktop', 'generic', 'grok'])
    for (const [name, profile] of Object.entries(clients.clients)) {
      for (const field of FIELDS) {
        const { value, source } = profile[field] ?? {}
        expect([true, false, 'not checked'], `${name}.${field}`).toContain(value)
        // A "not checked" value may name the page that was read but did not state the fact; true or false needs that page.
        if (value === 'not checked') expect(source === 'not checked' || URL_RE.test(source), `${name}.${field}`).toBe(true)
        else expect(source, `${name}.${field}`).toMatch(URL_RE)
      }
    }
  })
})

describe('discovery score', () => {
  const report = evaluate({ tools, instructions: INSTRUCTIONS, intents, negatives, admin: listAdminTools() })

  it('has a recorded floor for every intent, language and mode, and a threshold for every negative', () => {
    for (const mode of MODES) {
      for (const intent of intents) {
        for (const lang of ['en', 'he']) expect(baseline.modes[mode].cells[intent.id]?.[lang], `${mode} ${intent.id} ${lang}`).toBeDefined()
      }
      for (const lang of ['en', 'he']) expect(baseline.modes[mode].negatives[lang], `${mode} negatives ${lang}`).toBeDefined()
    }
  })

  it('is not below the recorded baseline (top-1, top-3, margin, negatives, admin)', () => {
    console.log(formatTable(report))
    const failures = checkAgainst(report, baseline)
    expect(failures, failures.join('\n')).toEqual([])
  })

  it('never lets an admin tool rank first for a normal phrase, except the recorded known failures', () => {
    const offending = report.adminFirst.filter((hit) => !baseline.known_failures.some((k) => k.kind === 'admin_first' && k.mode === hit.mode && k.text === hit.text))
    expect(offending).toEqual([])
  })

  it('keeps admin tool names out of the MCP prompts that every client can list', () => {
    const adminNames = listAdminTools().map((t) => t.name)
    const prompts = listPrompts()
    for (const prompt of prompts) {
      const text = `${prompt.name} ${prompt.title} ${prompt.description}`
      for (const name of adminNames) expect(text.includes(name), `${prompt.name} mentions ${name}`).toBe(false)
    }
  })

  it('keeps the best write-tool score of each negative at or below its threshold', () => {
    expect(WRITE_TOOLS.length).toBeGreaterThan(0)
    for (const mode of MODES) {
      for (const lang of ['en', 'he']) {
        expect(report.modes[mode].negatives[lang].max_write_score).toBeLessThanOrEqual(baseline.modes[mode].negatives[lang].max_write_score)
      }
    }
  })
})
