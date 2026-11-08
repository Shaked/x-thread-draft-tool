// Task 23 (docs/plans/hardening-finish.md): production skips builds for docs, CI and test-only merges.
import { describe, expect, it } from 'vitest'
import { shouldSkip } from '../../scripts/vercel-ignore.mjs'

const PROD = { VERCEL_ENV: 'production' }
const PREVIEW = { VERCEL_ENV: 'preview' }

describe('shouldSkip (Vercel ignored build step)', () => {
  it('never skips a preview build', () => {
    expect(shouldSkip(PREVIEW, ['docs/a.md'])).toBe(false)
  })

  it('skips production when only docs and CI files changed', () => {
    expect(shouldSkip(PROD, ['docs/a.md', '.github/x.yml'])).toBe(true)
  })

  it('builds production when a src file changed', () => {
    expect(shouldSkip(PROD, ['docs/a.md', 'src/App.jsx'])).toBe(false)
  })

  it('builds production for scripts/migrate.mjs (it runs in the build)', () => {
    expect(shouldSkip(PROD, ['scripts/migrate.mjs'])).toBe(false)
  })

  it('builds production when the file list is empty (no history)', () => {
    expect(shouldSkip(PROD, [])).toBe(false)
    expect(shouldSkip(PROD, undefined)).toBe(false)
  })

  it('builds production when vercel.json changed', () => {
    expect(shouldSkip(PROD, ['vercel.json'])).toBe(false)
  })
})
