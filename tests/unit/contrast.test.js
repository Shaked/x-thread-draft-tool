// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Reads the colour tokens from src/styles/tokens.css. Each token is written once as light-dark(<light>, <dark>).
const tokensCss = readFileSync(path.resolve('src/styles/tokens.css'), 'utf8')
const indexHtml = readFileSync(path.resolve('index.html'), 'utf8')

const HEX = '#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?'
const LIGHT_DARK = new RegExp(`^light-dark\\((${HEX}),\\s*(${HEX})\\)$`)
const OVERLAYS = ['overlay', 'overlay-strong', 'on-overlay'] // the same in both themes, not light-dark()

// Parses the --color-* tokens of one block of CSS into a light and a dark map.
function parseColours(css) {
  const themes = { light: {}, dark: {} }
  const plain = []
  for (const [, name, value] of css.matchAll(/^\s*--color-([\w-]+):\s*([^;]+);/gm)) {
    const pair = value.trim().match(LIGHT_DARK)
    if (pair) {
      themes.light[name] = pair[1]
      themes.dark[name] = pair[2]
    } else {
      plain.push(name)
      themes.light[name] = value.trim()
      themes.dark[name] = value.trim()
    }
  }
  return { themes, plain }
}

// The default tokens come before the skin block; the "rare" skin only overrides some of them (feature flag).
const SKIN_START = ":root[data-skin='rare'] {"
const skinAt = tokensCss.indexOf(SKIN_START)
const skinEnd = tokensCss.indexOf('\n}', skinAt)
const base = parseColours(tokensCss.slice(0, skinAt))
const rareOverrides = parseColours(tokensCss.slice(skinAt, skinEnd))
const THEMES = base.themes
const notLightDark = base.plain
const SKIN_THEMES = {
  default: THEMES,
  rare: {
    light: { ...THEMES.light, ...rareOverrides.themes.light },
    dark: { ...THEMES.dark, ...rareOverrides.themes.dark }
  }
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

const SURFACES = ['bg', 'surface', 'surface-2', 'surface-raised']
const SOFT = ['accent-soft', 'danger-soft', 'success-soft', 'warning-soft']

// The 51 pairs per theme (plan section 6, item 2). Text pairs need 4.5:1; borders and the focus ring 3:1.
const PAIRS = [
  ...['text', 'text-soft', 'accent', 'danger', 'success', 'warning'].flatMap((fg) => SURFACES.map((bg) => [fg, bg, 4.5])),
  ...['accent', 'accent-hover', 'accent-pressed'].map((bg) => ['text-on-accent', bg, 4.5]),
  ...['danger', 'danger-hover'].map((bg) => ['text-on-danger', bg, 4.5]),
  ['accent', 'accent-soft', 4.5],
  ['accent-soft-text', 'accent-soft', 4.5],
  ['danger', 'danger-soft', 4.5],
  ['success', 'success-soft', 4.5],
  ['warning', 'warning-soft', 4.5],
  ...['text', 'text-soft'].flatMap((fg) => SOFT.map((bg) => [fg, bg, 4.5])),
  ['bg', 'text', 4.5],
  ...['border', 'focus'].flatMap((fg) => SURFACES.map((bg) => [fg, bg, 3]))
]

describe('colour tokens', () => {
  it('has 51 pairs to check per theme', () => {
    expect(PAIRS).toHaveLength(51)
  })

  it('writes every --color-* token as light-dark() except the three overlay colours', () => {
    expect([...notLightDark].sort()).toEqual([...OVERLAYS].sort())
  })

  it('has the same token names in both themes', () => {
    expect(Object.keys(THEMES.dark).sort()).toEqual(Object.keys(THEMES.light).sort())
  })

  it('matches the theme-colour meta in index.html to the light page background', () => {
    const meta = indexHtml.match(/<meta name="theme-color" content="([^"]+)"/)
    expect(meta).not.toBeNull()
    expect(meta[1]).toBe(THEMES.light.bg)
  })
})

describe.each(Object.keys(SKIN_THEMES))('colour contrast, %s skin', (skin) => {
  for (const theme of ['light', 'dark']) {
    describe(`${theme} theme`, () => {
      for (const [fg, bg, min] of PAIRS) {
        it(`${fg} on ${bg} is at least ${min}:1`, () => {
          const colours = SKIN_THEMES[skin][theme]
          const ratio = contrast(colours[fg], colours[bg])
          expect(ratio, `${fg} ${colours[fg]} on ${bg} ${colours[bg]}`).toBeGreaterThanOrEqual(min)
        })
      }
    })
  }

  it('reads every pair token in both themes as a 6-digit hex colour', () => {
    for (const colours of Object.values(SKIN_THEMES[skin])) {
      for (const [fg, bg] of PAIRS) {
        expect(colours[fg]).toMatch(/^#[0-9a-f]{6}$/i)
        expect(colours[bg]).toMatch(/^#[0-9a-f]{6}$/i)
      }
    }
  })
})

describe('rare skin overrides', () => {
  it('only overrides tokens that exist in the default set, as light-dark() pairs', () => {
    expect(rareOverrides.plain).toEqual([])
    for (const name of Object.keys(rareOverrides.themes.light)) expect(THEMES.light).toHaveProperty(name)
  })
})
