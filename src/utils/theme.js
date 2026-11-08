// Theme choice: light (default), dark, or system (follows the device). The choice is stored in
// localStorage under 'xt-theme'. index.html applies the stored value before the first paint.

export const THEME_KEY = 'xt-theme'
export const THEMES = ['light', 'dark', 'system']
const DARK_QUERY = '(prefers-color-scheme: dark)'

function readStored() {
  try {
    return localStorage.getItem(THEME_KEY)
  } catch {
    return null
  }
}

function writeStored(value) {
  try {
    localStorage.setItem(THEME_KEY, value)
  } catch {
    // Storage can be blocked (private mode, disabled site data). The choice still applies for this page.
  }
}

/** The saved choice, or 'light' when nothing valid is stored. */
export function getTheme() {
  const stored = readStored()
  return THEMES.includes(stored) ? stored : 'light'
}

/** 'light' or 'dark', resolving 'system' against the device setting. */
export function resolvedTheme(value = getTheme()) {
  if (value === 'dark') return 'dark'
  if (value === 'light') return 'light'
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
  }
  return 'light'
}

function syncMetaTags(resolved) {
  const scheme = document.querySelector('meta[name="color-scheme"]')
  if (scheme) scheme.setAttribute('content', resolved)
  // The browser UI colour stays light; only the dark choice darkens it.
  const themeColor = document.querySelector('meta[name="theme-color"]')
  if (themeColor) themeColor.setAttribute('content', resolved === 'dark' ? '#000000' : '#ffffff')
}

/** Applies a theme to the page (attribute and meta tags). Unknown values are ignored. */
export function applyTheme(value) {
  if (!THEMES.includes(value)) return getTheme()
  document.documentElement.dataset.theme = value
  syncMetaTags(resolvedTheme(value))
  return value
}

/** Saves and applies a theme. Returns the value now in effect. */
export function setTheme(value) {
  if (!THEMES.includes(value)) throw new Error(`Unknown theme: ${value}`)
  writeStored(value)
  return applyTheme(value)
}
