// @vitest-environment node
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

// Guard for speed task S4 (#311): the deployed smoke job runs without `npm ci`, so the scripts it
// runs may import only `node:*` modules and repository files. This follows every static import of
// the two scripts, recursively, and fails on any other specifier (a bare package name).
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const ENTRIES = ['scripts/smoke.mjs', 'scripts/notify-telegram.mjs']

// Every module specifier in an ES module: `import x from 'y'`, `import 'y'`, `export ... from 'y'`
// and `import('y')`. Only string literals count; the scripts use no other form.
const SPECIFIER =
  /(?:\bimport\s+(?:[^'"`;]*?\s+from\s+)?|\bexport\s+[^'"`;]*?\s+from\s+|\bimport\s*\(\s*)['"]([^'"]+)['"]/g

function specifiers(source) {
  return [...source.matchAll(SPECIFIER)].map((m) => m[1])
}

describe('deployed smoke job: the scripts it runs need no installed packages', () => {
  it('follows the imports of smoke.mjs and notify-telegram.mjs and finds only node: and relative paths', () => {
    const seen = new Set()
    const bare = []
    const queue = [...ENTRIES]
    while (queue.length) {
      const rel = queue.shift()
      if (seen.has(rel)) continue
      seen.add(rel)
      const source = readFileSync(resolve(ROOT, rel), 'utf8')
      for (const spec of specifiers(source)) {
        if (spec.startsWith('node:')) continue
        if (spec.startsWith('./') || spec.startsWith('../')) {
          queue.push(resolve(dirname(resolve(ROOT, rel)), spec).slice(ROOT.length + 1))
          continue
        }
        bare.push(`${rel} imports '${spec}'`)
      }
    }
    expect(bare, 'no package import in the smoke job scripts').toEqual([])
    // The walk reached the files the job actually uses, so a broken walk cannot pass silently.
    expect(seen.has('server/mcp/ui/index.js')).toBe(true)
    expect(seen.has('server/share/x-css.js')).toBe(true)
  })
})
