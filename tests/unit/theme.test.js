import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, getTheme, resolvedTheme, setTheme, THEME_CHANGE_EVENT, THEME_KEY } from '../../src/utils/theme.js'

function mockMatchMedia(prefersDark) {
  window.matchMedia = vi.fn((query) => ({
    matches: prefersDark && query === '(prefers-color-scheme: dark)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {}
  }))
}

// A matchMedia mock that records 'change' listeners so a test can fire a device scheme change.
function mockDeviceScheme(initialDark) {
  const listeners = new Set()
  const query = {
    matches: initialDark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: vi.fn((type, fn) => {
      if (type === 'change') listeners.add(fn)
    }),
    removeEventListener: vi.fn((type, fn) => {
      if (type === 'change') listeners.delete(fn)
    })
  }
  window.matchMedia = vi.fn(() => query)
  return {
    query,
    fire(dark) {
      query.matches = dark
      listeners.forEach((fn) => fn({ matches: dark }))
    }
  }
}

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
    document.head.innerHTML =
      '<meta name="color-scheme" content="light"><meta name="theme-color" content="#ffffff">'
    mockMatchMedia(false)
  })

  afterEach(() => {
    applyTheme('light') // detaches any device listener left by the test
    document.head.innerHTML = ''
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

  it('system choice updates meta tags and dispatches an event when the device scheme changes', () => {
    const device = mockDeviceScheme(false)
    setTheme('system')
    expect(document.querySelector('meta[name="theme-color"]').getAttribute('content')).toBe('#ffffff')

    const onChange = vi.fn()
    window.addEventListener(THEME_CHANGE_EVENT, onChange)
    device.fire(true)

    expect(document.querySelector('meta[name="theme-color"]').getAttribute('content')).toBe('#000000')
    expect(document.querySelector('meta[name="color-scheme"]').getAttribute('content')).toBe('dark')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].detail).toEqual({ theme: 'system', resolved: 'dark' })

    device.fire(false)
    expect(document.querySelector('meta[name="theme-color"]').getAttribute('content')).toBe('#ffffff')
    expect(onChange).toHaveBeenCalledTimes(2)
    window.removeEventListener(THEME_CHANGE_EVENT, onChange)
  })

  it('a non-system choice registers no change listener, and leaving system removes it', () => {
    const device = mockDeviceScheme(false)
    setTheme('dark')
    setTheme('light')
    expect(device.query.addEventListener).not.toHaveBeenCalledWith('change', expect.any(Function))

    setTheme('system')
    expect(device.query.addEventListener).toHaveBeenCalledWith('change', expect.any(Function))
    setTheme('light')
    expect(device.query.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })
})
