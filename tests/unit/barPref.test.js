import { afterEach, describe, expect, it, vi } from 'vitest'
import { BAR_KEY, isBarHidden, setBarHidden } from '../../src/utils/barPref.js'

describe('barPref', () => {
  afterEach(() => {
    // The page-level fallback is module state: reset it so each test starts shown.
    setBarHidden(false)
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('is not hidden by default', () => {
    expect(isBarHidden()).toBe(false)
  })

  it('stores hidden under xt-bar and reads it back', () => {
    expect(setBarHidden(true)).toBe(true)
    expect(localStorage.getItem(BAR_KEY)).toBe('hidden')
    expect(BAR_KEY).toBe('xt-bar')
    expect(isBarHidden()).toBe(true)
  })

  it('stores shown when the bar is shown again', () => {
    setBarHidden(true)
    expect(setBarHidden(false)).toBe(false)
    expect(localStorage.getItem(BAR_KEY)).toBe('shown')
    expect(isBarHidden()).toBe(false)
  })

  it('treats a junk stored value as not hidden', () => {
    localStorage.setItem(BAR_KEY, 'maybe')
    expect(isBarHidden()).toBe(false)
  })

  it('keeps the choice for this page when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => setBarHidden(true)).not.toThrow()
    expect(isBarHidden()).toBe(true)
  })
})
