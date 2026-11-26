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
  const gated = [...app.matchAll(/isAdmin\(user\) && \(?\s*<Route\s+path="([^"]+)"/g)].map((m) => m[1].replace(/\/\*$/, ''))
  return [...new Set([...gated.filter((p) => p !== '/admin'), ...entries, ...own])].sort()
}
