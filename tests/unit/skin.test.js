import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { allowFlags, forgetFlags, applySkin, getKit, getSkin, KIT_KEY, setKit, setSkin, SKIN_KEY } from '../../src/utils/skin.js'

describe('skin (look feature flag, Rare UI by default #406)', () => {
  beforeEach(() => {
    localStorage.clear()
    allowFlags(true)
    delete document.documentElement.dataset.skin
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('gives every user who is not the admin Rare UI, whatever is stored (#483, #406)', () => {
    localStorage.setItem(SKIN_KEY, 'default')
    localStorage.setItem(KIT_KEY, 'default')
    expect(allowFlags(false)).toBe('rare')
    expect(document.documentElement.dataset.skin).toBe('rare')
    expect(getSkin()).toBe('rare')
    expect(getKit()).toBe('rare')
    expect(setSkin('default')).toBe('rare')
    expect(setKit('default')).toBe('rare')
    expect(localStorage.getItem(SKIN_KEY)).toBe('default')
    expect(allowFlags(true)).toBe('default')
  })

  it('defaults to Rare UI for the admin too, when nothing is stored', () => {
    expect(getSkin()).toBe('rare')
    expect(getKit()).toBe('rare')
  })

  it('saves the admin choice and puts it on <html>', () => {
    expect(setSkin('default')).toBe('default')
    expect(localStorage.getItem(SKIN_KEY)).toBe('default')
    expect(document.documentElement.dataset.skin).toBe('default')
    expect(getSkin()).toBe('default')
  })

  it('ignores a stored value it does not know', () => {
    localStorage.setItem(SKIN_KEY, 'neon')
    expect(getSkin()).toBe('rare')
    expect(applySkin()).toBe('rare')
    expect(document.documentElement.dataset.skin).toBe('rare')
  })

  it('goes back to Rare UI from the old look', () => {
    setSkin('default')
    setSkin('rare')
    expect(getSkin()).toBe('rare')
    expect(document.documentElement.dataset.skin).toBe('rare')
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
      setSkin('rare')
    }
    expect(document.documentElement.dataset.skin).toBe('rare')
    expect(getSkin()).toBe('rare')
  })

  it('keeps the components choice apart from the look: Rare UI by default, saved, unknown ignored, blocked storage', () => {
    expect(getKit()).toBe('rare')
    expect(setKit('default')).toBe('default')
    expect(localStorage.getItem(KIT_KEY)).toBe('default')
    expect(getSkin()).toBe('rare')
    localStorage.setItem(KIT_KEY, 'neon')
    expect(getKit()).toBe('rare')
    const real = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new Error('blocked')
    }
    try {
      expect(setKit('default')).toBe('default')
      expect(getKit()).toBe('default')
    } finally {
      Storage.prototype.setItem = real
      setKit('rare')
    }
    expect(getKit()).toBe('rare')
  })

  it('forgets the stored look, components and admin mark for a device whose user is not the admin (#483)', () => {
    setSkin('default')
    setKit('default')
    expect(localStorage.getItem('xt-admin')).toBe('1')
    forgetFlags()
    expect([SKIN_KEY, KIT_KEY, 'xt-admin'].map((key) => localStorage.getItem(key))).toEqual([null, null, null])
  })

  it('index.html paints Rare UI unless this device last saw the admin and the admin chose the old look (#483, #406)', () => {
    const html = readFileSync('index.html', 'utf8')
    expect(html).toContain("localStorage.getItem('xt-admin') === '1' && localStorage.getItem('xt-skin') === 'default' ? 'default' : 'rare'")
    expect(html).toContain("document.documentElement.dataset.skin = 'rare';")
  })
})
