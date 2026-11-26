// @vitest-environment node
// The admin pages stay out of the normal bundle (#285, #482). Reads source files as text.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (path) => readFileSync(join(ROOT, path), 'utf8')

function sourceFiles(dir) {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.jsx?$/.test(entry.name) ? [path] : []
  })
}

describe('admin pages are a lazy chunk', () => {
  it('src/App.jsx imports pages/admin only through lazy(() => import(...))', () => {
    const imports = [...read('src/App.jsx').matchAll(/(?:^|\s)(?:import\s[^;\n]*?from\s*|import\s*\(?\s*)['"]([^'"]*pages\/admin[^'"]*)['"]/g)]
    expect(imports.length).toBeGreaterThan(0)
    expect(read('src/App.jsx')).toMatch(/lazy\(\(\) => import\('\.\/pages\/admin\/[A-Za-z]+'\)\)/)
    expect(read('src/App.jsx')).not.toMatch(/^import [^\n]*pages\/admin/m)
  })

  it('no other file in src/ imports pages/admin', () => {
    const offenders = sourceFiles('src')
      .filter((file) => file !== 'src/App.jsx' && !file.startsWith('src/pages/admin/'))
      .filter((file) => /pages\/admin|\.\/admin\//.test(read(file)))
    expect(offenders).toEqual([])
  })

  it('vite.config.js keeps the admin chunk (named after AdminLayout) out of the service worker precache', () => {
    expect(read('vite.config.js')).toMatch(/globIgnores:\s*\[[^\]]*assets\/AdminLayout-/)
  })
})
