// The pages of the admin area, read from the source (#485). Used by the access tests (API and unit).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// vitest runs from the repository root (jsdom has no file URL for import.meta.url).
const ROOT = process.cwd()
export const readSrc = (path) => readFileSync(join(ROOT, path), 'utf8')

/** Every admin page path: the shell entries of AdminLayout, its own routes, and the old /changelog address that App.jsx redirects. */
export function adminPages() {
  const layout = readSrc('src/pages/admin/AdminLayout.jsx')
  const entries = [...layout.matchAll(/\{ path: '([^']*)', label:/g)].map((m) => (m[1] ? `/admin/${m[1]}` : '/admin'))
  const own = [...layout.matchAll(/<Route path="([^"*]+)"/g)].map((m) => `/admin/${m[1]}`)
  const app = readSrc('src/App.jsx')
  // Every admin address written in App.jsx (any attribute order, any quote, any case), and the path of every route that mounts AdminLayout.
  const written = [...app.matchAll(/['"](\/admin[^'"]*|\/changelog[^'"]*)['"]/gi)].map((m) => m[1].replace(/\/\*$/, ''))
  const mounts = [...app.matchAll(/<AdminLayout\b/g)].map((m) => {
    const before = [...app.slice(0, m.index).matchAll(/path=['"]([^'"]+)['"]/g)].at(-1)
    return before ? before[1].replace(/\/\*$/, '') : '(no path)'
  })
  const gated = [...written, ...mounts]
  return [...new Set([...gated, ...entries, ...own])].sort()
}
