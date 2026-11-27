// The host capability layer (#292): one table of what each host can do, and the small functions the views ask it.
// A client improvement is one row in hostTable() or one renderer in render/. Same rules as client.js: the functions are
// copied into the view with toString(), so they have no module-level constants and use only their arguments, the page
// globals and the other view functions. The table is a function for that reason (like labels() in client.js).
/* global clampInset */

/**
 * What each host can do. "mcp" is an MCP Apps host, "openai" is ChatGPT (window.openai); a row is picked by hostRow.
 *  - theme(w, c): where the host says "dark" or "light": hostContext.theme or window.openai.theme.
 *  - openLink: how a link is opened: "ui/open-link" is the bridge request, anything else a method of window.openai.
 *  - displayModes: the window.openai method that asks for full screen; a host without one has no such key.
 *  - csp: the key of the resource _meta that holds the CSP: "ui" (_meta.ui.csp) or "openai/widgetCSP".
 *  - insets(w, c): the safe-area insets, from hostContext.safeAreaInsets.
 */
export function hostTable() {
  const insets = (w, c) => c && c.safeAreaInsets
  return {
    mcp: { theme: (w, c) => c && c.theme, openLink: 'ui/open-link', csp: 'ui', insets },
    openai: { theme: (w) => w.openai.theme, openLink: 'openExternal', displayModes: 'requestDisplayMode', csp: 'openai/widgetCSP', insets }
  }
}

/** The t row for this page: "openai" when window.openai exists, else "mcp". */
export function hostRow(w) {
  return hostTable()[w.openai ? 'openai' : 'mcp']
}

/** "dark" or "light" from the first source in the table that has one (the host context, then window.openai); else null. */
export function hostTheme(w, c) {
  const t = hostTable()
  const ts = [t.mcp.theme(w, c), w.openai && t.openai.theme(w)]
  return ts.find((theme) => theme === 'dark' || theme === 'light') || null
}

/**
 * The window.openai method this host uses for a capability of its row ("openLink" or "displayModes"), or null when the
 * page does not have it: then a link goes through the bridge's ui/open-link and there is no full-screen button.
 */
export function hostMethod(w, k) {
  const m = hostRow(w)[k]
  return m && w.openai && typeof w.openai[m] === 'function' ? m : null
}

/** The safe-area insets of this host as { top, right, bottom, left } in px; a side that is missing or out of range is left out. */
export function hostInsets(w, c) {
  const r = hostRow(w).insets(w, c) || {}
  const o = {}
  ;['top', 'right', 'bottom', 'left'].forEach((s) => {
    const px = clampInset(r[s])
    if (px !== null) o[s] = px
  })
  return o
}

// The functions the thread view copies, in this order.
export const HOST_FUNCTIONS = [hostTable, hostRow, hostTheme, hostMethod, hostInsets]
