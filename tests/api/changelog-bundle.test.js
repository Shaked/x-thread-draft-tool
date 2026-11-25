// @vitest-environment node
// The changelog text is not in the browser bundle (#368): the page loads it from the admin-only route.
// Reads dist/ (the CI build runs before the API tests) and server/generated/changelog.js (written by the build).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const DIST = join(ROOT, 'dist')

function jsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return jsFiles(path)
    return name.endsWith('.js') ? [path] : []
  })
}

describe('the browser bundle has no changelog text', () => {
  it('no entry summary or long title appears in dist/ (the build ran)', async () => {
    expect(existsSync(DIST), 'run npm run build first').toBe(true)
    const entries = (await import('../../server/generated/changelog.js')).default
    const bundle = jsFiles(DIST).map((path) => readFileSync(path, 'utf8')).join('\n')
    // Long texts only, so a common word cannot match. The escaped form covers quotes and newlines.
    const texts = entries.flatMap((entry) => [entry.summary, entry.title]).filter((text) => typeof text === 'string' && text.length >= 40)
    expect(texts.length).toBeGreaterThan(0)
    const leaked = texts.filter((text) => bundle.includes(text) || bundle.includes(JSON.stringify(text).slice(1, -1)))
    expect(leaked.map((text) => text.slice(0, 60))).toEqual([])
  })
})
