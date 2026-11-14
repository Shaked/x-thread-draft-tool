// Whether the phone bottom bar is hidden. Stored in this browser only, under 'xt-bar'.
export const BAR_KEY = 'xt-bar'

// The last choice made in this page. Used when storage is blocked.
let sessionHidden = false

/** True when the saved choice is 'hidden'. */
export function isBarHidden() {
  try {
    const stored = localStorage.getItem(BAR_KEY)
    if (stored === 'hidden' || stored === 'shown') return stored === 'hidden'
  } catch {
    // Storage can be blocked (private mode). The choice still holds for this page.
  }
  return sessionHidden
}

/** Saves the choice. Returns the value now in effect. */
export function setBarHidden(hidden) {
  sessionHidden = Boolean(hidden)
  try {
    localStorage.setItem(BAR_KEY, sessionHidden ? 'hidden' : 'shown')
  } catch {
    // See above.
  }
  return sessionHidden
}
