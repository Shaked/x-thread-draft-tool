import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_TTL_MS,
  hasRedirectChecked,
  markRedirectChecked,
  readLastLocation,
  readScrollPosition,
  restoreScrollWithRetries,
  saveLastLocation,
  saveScrollPosition,
  scrollKey
} from '../../src/utils/scrollRestoration.js'

describe('scrollKey', () => {
  it('namespaces by pathname', () => {
    expect(scrollKey('/draft/123')).toBe('xtdt:scroll:/draft/123')
  })

  it('falls back to root when missing', () => {
    expect(scrollKey('')).toBe('xtdt:scroll:/')
  })
})

describe('save/read scroll position', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('round-trips a scroll position via session storage', () => {
    saveScrollPosition('/draft/abc', 540)
    expect(readScrollPosition('/draft/abc')).toBe(540)
  })

  it('persists to localStorage so reads survive sessionStorage loss', () => {
    saveScrollPosition('/draft/abc', 200)
    window.sessionStorage.clear()
    expect(readScrollPosition('/draft/abc')).toBe(200)
  })

  it('drops entries older than the TTL', () => {
    const now = Date.now()
    const past = now - DEFAULT_TTL_MS - 1000
    const spy = vi.spyOn(Date, 'now').mockReturnValueOnce(past)
    saveScrollPosition('/draft/old', 100)
    spy.mockRestore()
    expect(readScrollPosition('/draft/old')).toBeNull()
  })

  it('returns null when nothing is stored', () => {
    expect(readScrollPosition('/never-visited')).toBeNull()
  })
})

describe('save/read last location', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('stores pathname, search and hash', () => {
    saveLastLocation('/draft/abc', '?foo=1', '#bar')
    expect(readLastLocation()).toMatchObject({
      pathname: '/draft/abc',
      search: '?foo=1',
      hash: '#bar'
    })
  })

  it('returns null after TTL', () => {
    const now = Date.now()
    const spy = vi.spyOn(Date, 'now').mockReturnValueOnce(now - DEFAULT_TTL_MS - 1)
    saveLastLocation('/draft/abc')
    spy.mockRestore()
    expect(readLastLocation()).toBeNull()
  })
})

describe('redirect guard', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('marks once and reads back true', () => {
    expect(hasRedirectChecked()).toBe(false)
    markRedirectChecked()
    expect(hasRedirectChecked()).toBe(true)
  })
})

describe('restoreScrollWithRetries', () => {
  let originalScrollTo
  let scrollY
  let scrollHeight

  beforeEach(() => {
    vi.useFakeTimers()
    scrollY = 0
    scrollHeight = 200 // shorter than the 1000 target initially
    originalScrollTo = window.scrollTo

    window.scrollTo = vi.fn((x, y) => {
      const maxY = Math.max(0, scrollHeight - window.innerHeight)
      scrollY = Math.min(y, maxY)
    })

    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      get: () => scrollY
    })
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 800
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    window.scrollTo = originalScrollTo
  })

  it('retries until the document grows tall enough to hit the target', () => {
    const cancel = restoreScrollWithRetries(1000, { intervalMs: 50, maxAttempts: 20 })

    // First attempt clamps to current max (200 - 800 < 0 => 0).
    expect(window.scrollTo).toHaveBeenCalled()

    // Grow the document and tick through retries.
    scrollHeight = 2000
    vi.advanceTimersByTime(50)
    vi.advanceTimersByTime(50)

    expect(scrollY).toBe(1000)
    cancel()
  })

  it('stops retrying after maxAttempts', () => {
    const cancel = restoreScrollWithRetries(5000, { intervalMs: 10, maxAttempts: 3 })
    // scrollHeight stays 200; document never grows. Drain timers.
    vi.advanceTimersByTime(1000)
    expect(window.scrollTo.mock.calls.length).toBeLessThanOrEqual(3)
    cancel()
  })

  it('cancel() prevents further attempts', () => {
    const cancel = restoreScrollWithRetries(1000, { intervalMs: 20, maxAttempts: 10 })
    cancel()
    const callsBefore = window.scrollTo.mock.calls.length
    vi.advanceTimersByTime(500)
    expect(window.scrollTo.mock.calls.length).toBe(callsBefore)
  })
})
