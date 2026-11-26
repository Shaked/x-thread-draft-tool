// A length token from src/styles/tokens.css in px (rem is read against the root font size), for the widths
// motion animates. 0 where styles are not computed (jsdom).
export function tokenPx(name) {
  const root = getComputedStyle(document.documentElement)
  const value = root.getPropertyValue(name).trim()
  const number = Number.parseFloat(value)
  if (!Number.isFinite(number)) return 0
  return value.endsWith('rem') ? number * Number.parseFloat(root.fontSize) : number
}
