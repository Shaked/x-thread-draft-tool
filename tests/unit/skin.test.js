import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applySkin, getSkin, setSkin, SKIN_KEY } from '../../src/utils/skin.js'

describe('skin (look feature flag)', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.skin
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('defaults to the current look', () => {
    expect(getSkin()).toBe('default')
  })

  it('saves the choice and puts it on <html>', () => {
    expect(setSkin('rare')).toBe('rare')
    expect(localStorage.getItem(SKIN_KEY)).toBe('rare')
    expect(document.documentElement.dataset.skin).toBe('rare')
    expect(getSkin()).toBe('rare')
  })

  it('ignores a stored value it does not know', () => {
    localStorage.setItem(SKIN_KEY, 'neon')
    expect(getSkin()).toBe('default')
    expect(applySkin()).toBe('default')
    expect(document.documentElement.dataset.skin).toBe('default')
  })

  it('goes back to the current look', () => {
    setSkin('rare')
    setSkin('default')
    expect(getSkin()).toBe('default')
    expect(document.documentElement.dataset.skin).toBe('default')
  })

  it('keeps the choice for the page when storage is blocked', () => {
    const real = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new Error('blocked')
    }
    try {
      expect(setSkin('rare')).toBe('rare')
    } finally {
      Storage.prototype.setItem = real
    }
    expect(document.documentElement.dataset.skin).toBe('rare')
  })
})
