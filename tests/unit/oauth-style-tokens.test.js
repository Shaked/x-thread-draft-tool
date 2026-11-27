// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { colours, controlHeight, fontStack, radius } from '../../server/oauth/style.js'

// server/oauth/style.js copies a few values from src/styles/tokens.css (the Rare look, the default skin).
// This test reads the token file as text and fails when a copied value no longer matches it.
const tokensCss = readFileSync(path.resolve('src/styles/tokens.css'), 'utf8')

// The Rare skin block; its tokens override the defaults in the first block.
const rareStart = tokensCss.indexOf(":root[data-skin='rare'] {")
const rareEnd = tokensCss.indexOf('\n}', rareStart)
const rareBlock = tokensCss.slice(rareStart, rareEnd)
const defaultBlock = tokensCss.slice(0, rareStart)

// The value a token has in the Rare look: its override if the skin sets one, else the default.
function declared(name) {
  const decl = new RegExp(`${name}:\\s*([^;]+);`)
  const hit = rareBlock.match(decl) ?? defaultBlock.match(decl)
  if (!hit) throw new Error(`token ${name} is not declared in tokens.css`)
  return hit[1].replace(/\s+/g, ' ').trim()
}

const compact = (value) => value.replace(/\s+/g, '')

describe('server/oauth/style.js values equal tokens.css', () => {
  for (const [key, [token, light, dark]] of Object.entries(colours)) {
    it(`${key} is ${token} as light-dark(light, dark)`, () => {
      expect(compact(declared(token))).toBe(compact(`light-dark(${light},${dark})`))
    })
  }

  for (const [key, [token, value]] of Object.entries({ ...radius, controlHeight: controlHeight })) {
    it(`${key} is ${token}`, () => {
      expect(declared(token)).toBe(value)
    })
  }

  it('the font stack is --font-sans', () => {
    expect(compact(declared(fontStack[0]))).toBe(compact(fontStack[1]))
  })
})
