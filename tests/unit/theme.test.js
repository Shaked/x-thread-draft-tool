import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTheme, resolvedTheme, setTheme, THEME_KEY } from '../../src/utils/theme.js'

function mockMatchMedia(prefersDark) {
  window.matchMedia = vi.fn((query) => ({
    matches: prefersDark && query === '(prefers-color-scheme: dark)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {}
  }))
}

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
    mockMatchMedia(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('defaults to light when nothing is stored', () => {
    expect(getTheme()).toBe('light')
    expect(resolvedTheme()).toBe('light')
  })

  it('persists a choice across reads and applies it to the page', () => {
    setTheme('dark')
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')
    expect(getTheme()).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('ignores an invalid stored value and falls back to light', () => {
    localStorage.setItem(THEME_KEY, 'neon')
    expect(getTheme()).toBe('light')
  })

  it('rejects an unknown value when setting', () => {
    expect(() => setTheme('neon')).toThrow(/Unknown theme/)
    expect(localStorage.getItem(THEME_KEY)).toBeNull()
  })

  it('resolves system from the device setting', () => {
    mockMatchMedia(true)
    expect(resolvedTheme('system')).toBe('dark')
    mockMatchMedia(false)
    expect(resolvedTheme('system')).toBe('light')
  })

  it('keeps working when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(getTheme()).toBe('light')
    expect(setTheme('dark')).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
