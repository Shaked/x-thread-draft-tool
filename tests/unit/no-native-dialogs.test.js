// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// No alert(), confirm() or window.confirm() in src/ (they became Dialog and Toast). One read per file, text only.
const files = readdirSync('src', { recursive: true })
  .filter((file) => /\.jsx?$/.test(file))
  .map((file) => path.join('src', file))

describe('native dialogs', () => {
  it('src/ has no alert( or confirm( call', () => {
    const found = files.filter((file) => /(^|[^\w.])(window\.)?(alert|confirm)\s*\(/.test(readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')))
    expect(found).toEqual([])
  })
})
