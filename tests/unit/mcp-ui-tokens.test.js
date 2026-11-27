// #357: the MCP views copy the purple accent from src/styles/tokens.css (the views cannot import the React styles).
// This test reads both and fails when the copy drifts from the source.
import './helpers/page-globals.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACCENT_DARK, ACCENT_LIGHT, ACCENT_VARS_DARK, ACCENT_VARS_LIGHT } from '../../server/mcp/ui/tokens.js'
import { STYLE } from '../../server/mcp/ui/thread.js'

// Vitest runs from the repo root (npm test), so the path is relative to it.
const tokensCss = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8')

// "--color-accent: light-dark(#6d28d9, #b69cff);" -> { light: '#6d28d9', dark: '#b69cff' }
function lightDark(name) {
  const match = tokensCss.match(new RegExp(`--color-${name}:\\s*light-dark\\((#[0-9a-fA-F]{6}),\\s*(#[0-9a-fA-F]{6})\\)`))
  if (!match) throw new Error(`tokens.css has no light-dark value for --color-${name}`)
  return { light: match[1].toLowerCase(), dark: match[2].toLowerCase() }
}

describe('MCP view accent tokens match src/styles/tokens.css (#357)', () => {
  it('the accent and focus colours are the same in light and dark', () => {
    const accent = lightDark('accent')
    const focus = lightDark('focus')
    expect({ accent: ACCENT_LIGHT.accent, focus: ACCENT_LIGHT.focus }).toEqual({ accent: accent.light, focus: focus.light })
    expect({ accent: ACCENT_DARK.accent, focus: ACCENT_DARK.focus }).toEqual({ accent: accent.dark, focus: focus.dark })
  })

  it('the view stylesheet defines both sets for light and dark, and the buttons use the accent', () => {
    expect(STYLE).toContain(ACCENT_VARS_LIGHT)
    expect(STYLE).toContain(ACCENT_VARS_DARK)
    expect(STYLE).toMatch(/button \{[^}]*color: var\(--accent\)/)
  })
})
