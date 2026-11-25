// Look choice (feature flag): 'default' (the purple design system) or 'rare' (the Rare UI look). The choice is
// stored in localStorage under 'xt-skin' and set as data-skin on <html>; src/styles/tokens.css restyles every page
// from that one attribute. index.html applies the stored value before the first paint.

export const SKIN_KEY = 'xt-skin'
const SKINS = ['default', 'rare']

// Set only when storage refused the last write: this page's choice then wins over an older stored value.
let sessionSkin = null

function readStored() {
  try {
    return localStorage.getItem(SKIN_KEY)
  } catch {
    return null
  }
}

/** The current choice, or 'default' when nothing valid is stored. */
export function getSkin() {
  if (SKINS.includes(sessionSkin)) return sessionSkin
  const stored = readStored()
  return SKINS.includes(stored) ? stored : 'default'
}

/** Puts the skin on <html>. An unknown value falls back to 'default'. */
export function applySkin(value = getSkin()) {
  const skin = SKINS.includes(value) ? value : 'default'
  document.documentElement.dataset.skin = skin
  return skin
}

/** Saves and applies the choice. Returns the skin that is now active. */
export function setSkin(value) {
  const skin = SKINS.includes(value) ? value : 'default'
  try {
    localStorage.setItem(SKIN_KEY, skin)
    sessionSkin = null
  } catch {
    // Storage can be blocked (private mode, full). The choice still applies for this page.
    sessionSkin = skin
  }
  return applySkin(skin)
}
