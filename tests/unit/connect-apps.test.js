import { describe, expect, it } from 'vitest'
import { connectEntries } from '../../src/utils/connectApps.js'

const URL_ = 'https://x-thread-draft-tool.vercel.app/api/mcp'

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
