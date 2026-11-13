import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Reads the colour tokens straight from App.css, so the test checks the values the page uses.
const css = readFileSync(path.resolve('src/styles/App.css'), 'utf8')

function tokensIn(block) {
  const tokens = {}
  for (const [, name, value] of block.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) {
    tokens[name] = value
  }
  return tokens
}

function blockFor(selector) {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`no block for ${selector}`)
  return css.slice(start, css.indexOf('}', start))
}

const THEMES = {
  light: tokensIn(blockFor(':root')),
  dark: tokensIn(blockFor(':root[data-theme="dark"]'))
}

function luminance(hex) {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// Pairs from the plan, with the minimum ratio for each (WCAG 2.1 AA).
const PAIRS = [
  ['text', 'bg', 4.5],
  ['text', 'surface', 4.5],
  ['muted', 'bg', 4.5],
  ['accent-text', 'accent', 4.5],
  ['danger', 'bg', 4.5],
  ['border', 'bg', 3],
  ['focus', 'bg', 3]
]

describe('colour contrast', () => {
  for (const theme of Object.keys(THEMES)) {
    describe(`${theme} theme`, () => {
      for (const [fg, bg, min] of PAIRS) {
        it(`${fg} on ${bg} is at least ${min}:1`, () => {
          const colours = THEMES[theme]
          const ratio = contrast(colours[`--${fg}`], colours[`--${bg}`])
          expect(ratio, `${fg} ${colours[`--${fg}`]} on ${bg} ${colours[`--${bg}`]}`).toBeGreaterThanOrEqual(min)
        })
      }
    })
  }

  it('reads every pair token in both themes', () => {
    for (const colours of Object.values(THEMES)) {
      for (const [fg, bg] of PAIRS) {
        expect(colours[`--${fg}`]).toMatch(/^#[0-9a-f]{6}$/i)
        expect(colours[`--${bg}`]).toMatch(/^#[0-9a-f]{6}$/i)
      }
    }
  })
})
