// Feature flags for the look, stored per device in localStorage.
// - Look ('xt-skin'): 'default' (the purple design system) or 'rare' (the Rare UI colours). Set as data-skin on
//   <html>; src/styles/tokens.css restyles every page from that one attribute. index.html applies the stored
//   value before the first paint.
// - Components ('xt-kit'): 'default' (our src/ui components) or 'rare' (some controls are the real Rare UI
//   components from src/ui/rare/, which follow the look through the same tokens). Read when a wrapper renders.

export const SKIN_KEY = 'xt-skin'
export const KIT_KEY = 'xt-kit'
const SKINS = ['default', 'rare']
const KITS = ['default', 'rare']

// One stored choice. The first value is the default. When storage refused the last write, this page's choice
// wins over an older stored value.
function storedChoice(key, values) {
  let session = null
  const read = () => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }
  return {
    get() {
      if (values.includes(session)) return session
      const stored = read()
      return values.includes(stored) ? stored : values[0]
    },
    set(value) {
      const next = values.includes(value) ? value : values[0]
      try {
        localStorage.setItem(key, next)
        session = null
      } catch {
        // Storage can be blocked (private mode, full). The choice still applies for this page.
        session = next
      }
      return next
    }
  }
}

const skin = storedChoice(SKIN_KEY, SKINS)
const kit = storedChoice(KIT_KEY, KITS)

/** The current look, or 'default' when nothing valid is stored. */
export function getSkin() {
  return skin.get()
}

/** Puts the skin on <html>. An unknown value falls back to 'default'. */
export function applySkin(value = getSkin()) {
  const next = SKINS.includes(value) ? value : 'default'
  document.documentElement.dataset.skin = next
  return next
}

/** Saves and applies the look. Returns the skin that is now active. */
export function setSkin(value) {
  return applySkin(skin.set(value))
}

/** The current components choice, or 'default' when nothing valid is stored. */
export function getKit() {
  return kit.get()
}

/** Saves the components choice. Returns the choice that is now active; wrappers read it when they render. */
export function setKit(value) {
  return kit.set(value)
}
