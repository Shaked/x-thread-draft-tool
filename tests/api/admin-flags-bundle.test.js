// @vitest-environment node
// #483: the Feature flags page text is only in the lazy admin chunk, never in a file a normal user loads.
// Reads dist/ (the CI build runs before the API tests).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ASSETS = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'dist', 'assets')

describe('the browser bundle has no flags page text outside the admin chunk', () => {
  it('the page texts appear only in assets/AdminLayout-*', () => {
    expect(existsSync(ASSETS), 'run npm run build first').toBe(true)
    const files = readdirSync(ASSETS).filter((name) => name.endsWith('.js'))
    for (const text of ['Purple (everyone)', 'Rare UI (only you)', 'Could not save the flag', 'Could not load the feature flags']) {
      const found = files.filter((name) => readFileSync(join(ASSETS, name), 'utf8').includes(text))
      expect(found.length, text).toBeGreaterThan(0)
      expect(found.filter((name) => !name.startsWith('AdminLayout-')), text).toEqual([])
    }
  })
})
