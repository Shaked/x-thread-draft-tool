// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { connectEntries, PASTE_IN, PASTE_PLACES } from '../../src/utils/connectApps.js'

const URL_ = 'https://x-thread-draft-tool.vercel.app/api/mcp'

// Each quoted paragraph in docs/agents/mcp.md is wrapped over lines that start with "> ". Join them with one
// space, as a reader sees the paragraph, and compare the whole paragraph with the UI text.
const MCP_DOC = readFileSync(path.resolve('docs/agents/mcp.md'), 'utf8')
const docParagraphs = []
let quoted = null
for (const line of MCP_DOC.split('\n')) {
  if (line.startsWith('> ')) quoted = quoted === null ? line.slice(2) : `${quoted} ${line.slice(2)}`
  else if (quoted !== null) {
    docParagraphs.push(quoted)
    quoted = null
  }
}
if (quoted !== null) docParagraphs.push(quoted)

describe('connectEntries (M10)', () => {
  const entries = connectEntries(URL_)

  it('lists Claude, Claude Code, ChatGPT and Codex CLI in that order', () => {
    expect(entries.map((entry) => entry.name)).toEqual(['Claude', 'Claude Code', 'ChatGPT', 'Codex CLI'])
  })

  it('copies the bare address for Claude and ChatGPT', () => {
    expect(entries.find((entry) => entry.id === 'claude').copy).toBe(URL_)
    expect(entries.find((entry) => entry.id === 'chatgpt').copy).toBe(URL_)
  })

  it('copies the exact Claude Code and Codex commands', () => {
    expect(entries.find((entry) => entry.id === 'claude-code').copy).toBe(
      `claude mcp add --transport http x-thread ${URL_}`
    )
    expect(entries.find((entry) => entry.id === 'codex').copy).toBe(`codex mcp add x-thread --url ${URL_}`)
  })

  it('gives every entry a hint and a copy label', () => {
    for (const entry of entries) {
      expect(entry.hint.length).toBeGreaterThan(0)
      expect(entry.copyLabel).toMatch(/^Copy /)
    }
  })
})

describe('PASTE_IN (U1, settings-menu.md M17)', () => {
  it('the English and the Hebrew text each appear word for word in docs/agents/mcp.md', () => {
    expect(docParagraphs).toContain(PASTE_IN.en)
    expect(docParagraphs).toContain(PASTE_IN.he)
  })

  it('the Hebrew text has no U+200F mark and both texts are NFC', () => {
    expect(PASTE_IN.he).not.toContain('‏')
    expect(PASTE_IN.he).toBe(PASTE_IN.he.normalize('NFC'))
    expect(PASTE_IN.en).toBe(PASTE_IN.en.normalize('NFC'))
  })

  it('lists the four places to paste it, in the order of the docs', () => {
    expect(PASTE_PLACES.map((place) => place.name)).toEqual(['ChatGPT', 'Claude', 'Claude Code', 'Codex'])
  })
})
