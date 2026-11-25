// Look choice (feature flag): 'default' (the purple design system) or 'rare' (the Rare UI look). The choice is
// stored in localStorage under 'xt-skin' and set as data-skin on <html>; src/styles/tokens.css restyles every page
// from that one attribute. index.html applies the stored value before the first paint.

export const SKIN_KEY = 'xt-skin'
export const SKINS = ['default', 'rare']

// The last choice made in this page. Used when storage is blocked, so the session keeps the choice.
let sessionSkin = null

function readStored() {
  try {
    return localStorage.getItem(SKIN_KEY)
  } catch {
    return null
  }
}

/** The saved choice, or 'default' when nothing valid is stored. */
export function getSkin() {
  const stored = readStored()
  if (SKINS.includes(stored)) return stored
  // Nothing stored (or storage blocked): use this page's last choice. A stored value we do not know means 'default'.
  if (stored === null && SKINS.includes(sessionSkin)) return sessionSkin
  return 'default'
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
  sessionSkin = skin
  try {
    localStorage.setItem(SKIN_KEY, skin)
  } catch {
    // Storage can be blocked (private mode). The choice still applies for this page.
  }
  return applySkin(skin)
}
