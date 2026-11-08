// Theme choice: light (default), dark, or system (follows the device). The choice is stored in
// localStorage under 'xt-theme'. index.html applies the stored value before the first paint.

export const THEME_KEY = 'xt-theme'
export const THEMES = ['light', 'dark', 'system']
const DARK_QUERY = '(prefers-color-scheme: dark)'
/** Fired on window when the device scheme changes while the choice is 'system'. */
export const THEME_CHANGE_EVENT = 'xt-theme-change'

// Only one listener at a time: it is attached while the choice is 'system' and removed otherwise.
let systemQuery = null
let systemListener = null

function readStored() {
  try {
    return localStorage.getItem(THEME_KEY)
  } catch {
    return null
  }
}

// The last choice made in this page. Used when storage is blocked, so the session keeps the choice.
let sessionTheme = null

function writeStored(value) {
  sessionTheme = value
  try {
    localStorage.setItem(THEME_KEY, value)
  } catch {
    // Storage can be blocked (private mode, disabled site data). The choice still applies for this page.
  }
}

/** The saved choice, or 'light' when nothing valid is stored. */
export function getTheme() {
  const stored = readStored()
  if (THEMES.includes(stored)) return stored
  return THEMES.includes(sessionTheme) ? sessionTheme : 'light'
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

function detachSystemListener() {
  if (systemQuery && systemListener) systemQuery.removeEventListener('change', systemListener)
  systemQuery = null
  systemListener = null
}

// Keeps meta tags and consumers (tweet embeds) in step with the device while the choice is 'system'.
function syncSystemListener(value) {
  detachSystemListener()
  if (value !== 'system') return
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
  const query = window.matchMedia(DARK_QUERY)
  if (!query || typeof query.addEventListener !== 'function') return
  systemListener = (event) => {
    const resolved = event && typeof event.matches === 'boolean'
      ? (event.matches ? 'dark' : 'light')
      : resolvedTheme('system')
    syncMetaTags(resolved)
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { theme: 'system', resolved } }))
  }
  systemQuery = query
  query.addEventListener('change', systemListener)
}

/** Applies a theme to the page (attribute, meta tags and device listener). Unknown values are ignored. */
export function applyTheme(value) {
  if (!THEMES.includes(value)) return getTheme()
  document.documentElement.dataset.theme = value
  syncMetaTags(resolvedTheme(value))
  syncSystemListener(value)
  return value
}

/** Saves and applies a theme. Returns the value now in effect. */
export function setTheme(value) {
  if (!THEMES.includes(value)) throw new Error(`Unknown theme: ${value}`)
  writeStored(value)
  return applyTheme(value)
}
