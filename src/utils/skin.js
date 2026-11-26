// The look and the components, stored per device in localStorage. Rare UI is the default for everyone (#406).
// - Look ('xt-skin'): 'rare' (the Rare UI colours, the default) or 'default' (the old purple look). Set as data-skin on
//   <html>; src/styles/tokens.css restyles every page from that one attribute. index.html applies it before the first paint.
// - Components ('xt-kit'): 'rare' (the real Rare UI components from src/ui/rare/: theme choice, Delete draft, character
//   count, toast; the default) or 'default' (the old src/ui components). Read when a wrapper renders.
// The admin keeps an off switch for both on /admin/flags (#483). Only the admin's stored choice is read; for anyone else
// the answer is always 'rare'. The device value is a copy of the admin account's flags (GET /api/admin/flags), kept so
// index.html can paint before the app loads.

export const SKIN_KEY = 'xt-skin'
export const KIT_KEY = 'xt-kit'
const ADMIN_KEY = 'xt-admin'
const SKINS = ['rare', 'default']
const KITS = ['rare', 'default']

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

/** Says whether the signed-in user is the admin. Only the admin's stored choice is read. Applies the look that follows. */
export function allowFlags(isAdmin) {
  allowed = isAdmin === true
  // index.html paints the stored look only on a device that last saw the admin (#483).
  try {
    if (allowed) localStorage.setItem(ADMIN_KEY, '1')
  } catch {
    // Storage can be blocked; the look then waits for the app.
  }
  return applySkin()
}

/** Removes the stored look, components and admin mark: this device's user is not the admin. */
export function forgetFlags() {
  try {
    for (const key of [SKIN_KEY, KIT_KEY, ADMIN_KEY]) localStorage.removeItem(key)
  } catch {
    // Storage can be blocked; nothing is stored then.
  }
}

/** The current look: the admin's stored choice, or 'rare' for everyone else. */
export function getSkin() {
  return allowed ? skin.get() : SKINS[0]
}

/** Puts the skin on <html>. An unknown value falls back to 'rare'. */
export function applySkin(value = getSkin()) {
  const next = SKINS.includes(value) ? value : SKINS[0]
  document.documentElement.dataset.skin = next
  return next
}

/** Saves and applies the look (admin only; for anyone else it stays 'rare'). Returns the skin that is now active. */
export function setSkin(value) {
  if (!allowed) return applySkin(SKINS[0])
  return applySkin(skin.set(value))
}

/** The current components choice: the admin's stored choice, or 'rare' for everyone else. */
export function getKit() {
  return allowed ? kit.get() : KITS[0]
}

/** Saves the components choice (admin only). Returns the choice that is now active; wrappers read it when they render. */
export function setKit(value) {
  return allowed ? kit.set(value) : KITS[0]
}
