import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { allowFlags, forgetFlags, applySkin, getKit, getSkin, KIT_KEY, setKit, setSkin, SKIN_KEY } from '../../src/utils/skin.js'

describe('skin (look feature flag)', () => {
  beforeEach(() => {
    localStorage.clear()
    allowFlags(true)
    delete document.documentElement.dataset.skin
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('ignores every stored value for a user who is not the admin (#483)', () => {
    localStorage.setItem(SKIN_KEY, 'rare')
    localStorage.setItem(KIT_KEY, 'rare')
    expect(allowFlags(false)).toBe('default')
    expect(document.documentElement.dataset.skin).toBe('default')
    expect(getSkin()).toBe('default')
    expect(getKit()).toBe('default')
    expect(setSkin('rare')).toBe('default')
    expect(setKit('rare')).toBe('default')
    expect(localStorage.getItem(SKIN_KEY)).toBe('rare')
    expect(allowFlags(true)).toBe('rare')
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

  it('keeps the choice for the page when storage is blocked, even over an older stored value', () => {
    localStorage.setItem(SKIN_KEY, 'rare')
    const real = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new Error('blocked')
    }
    try {
      expect(setSkin('default')).toBe('default')
      expect(getSkin()).toBe('default')
    } finally {
      Storage.prototype.setItem = real
      // The next write that works clears the page-only choice, so later tests start clean even if an assertion failed.
      setSkin('default')
    }
    expect(document.documentElement.dataset.skin).toBe('default')
    expect(getSkin()).toBe('default')
  })

  it('keeps the components choice apart from the look: default, saved, unknown ignored, blocked storage', () => {
    expect(getKit()).toBe('default')
    expect(setKit('rare')).toBe('rare')
    expect(localStorage.getItem(KIT_KEY)).toBe('rare')
    expect(getSkin()).toBe('default')
    expect(document.documentElement.dataset.skin).toBeUndefined()
    localStorage.setItem(KIT_KEY, 'neon')
    expect(getKit()).toBe('default')
    const real = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new Error('blocked')
    }
    try {
      expect(setKit('rare')).toBe('rare')
      expect(getKit()).toBe('rare')
    } finally {
      Storage.prototype.setItem = real
      setKit('default')
    }
    expect(getKit()).toBe('default')
  })

  it('forgets the stored look, components and admin mark for a device whose user is not the admin (#483)', () => {
    setSkin('rare')
    setKit('rare')
    expect(localStorage.getItem('xt-admin')).toBe('1')
    forgetFlags()
    expect([SKIN_KEY, KIT_KEY, 'xt-admin'].map((key) => localStorage.getItem(key))).toEqual([null, null, null])
  })

  it('index.html paints the stored look only on a device that last saw the admin (#483)', () => {
    const html = readFileSync('index.html', 'utf8')
    expect(html).toContain("localStorage.getItem('xt-admin') === '1' && localStorage.getItem('xt-skin') === 'rare'")
  })
})
