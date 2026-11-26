// Feature flags for the look, stored per device in localStorage.
// - Look ('xt-skin'): 'default' (the purple design system) or 'rare' (the Rare UI colours). Set as data-skin on
//   <html>; src/styles/tokens.css restyles every page from that one attribute. index.html applies the stored
//   value before the first paint.
// - Components ('xt-kit'): 'default' (our src/ui components) or 'rare' (some controls are the real Rare UI
//   components from src/ui/rare/, which follow the look through the same tokens). Read when a wrapper renders.
// Both flags are the admin's (#483): for anyone else a stored value is ignored and both read 'default'. The device
// value is a copy of the admin account's flags (GET /api/admin/flags), kept so index.html can paint before the app loads.

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

let allowed = false
const skin = storedChoice(SKIN_KEY, SKINS)
const kit = storedChoice(KIT_KEY, KITS)

/** Says whether the signed-in user may use the flags (the admin only). Applies the look that follows from it. */
export function allowFlags(isAdmin) {
  allowed = isAdmin === true
  return applySkin()
}

/** The current look, or 'default' when nothing valid is stored or the user is not the admin. */
export function getSkin() {
  return allowed ? skin.get() : 'default'
}

/** Puts the skin on <html>. An unknown value falls back to 'default'. */
export function applySkin(value = getSkin()) {
  const next = SKINS.includes(value) ? value : 'default'
  document.documentElement.dataset.skin = next
  return next
}

/** Saves and applies the look. Returns the skin that is now active. */
export function setSkin(value) {
  if (!allowed) return applySkin('default')
  return applySkin(skin.set(value))
}

/** The current components choice, or 'default' when nothing valid is stored. */
export function getKit() {
  return allowed ? kit.get() : 'default'
}

/** Saves the components choice. Returns the choice that is now active; wrappers read it when they render. */
export function setKit(value) {
  return allowed ? kit.set(value) : 'default'
}
