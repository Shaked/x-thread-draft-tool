// The few design values the OAuth consent and device pages use (plain server HTML, no CSS file).
// Each value is copied from src/styles/tokens.css, in the Rare look (the default skin, `:root[data-skin='rare']`).
// tests/unit/oauth-style-tokens.test.js reads tokens.css and fails when a value here differs from it.
// Do not add a token here unless a page in server/oauth uses it.

/** Colours: [token, light, dark]. Written as light-dark(light, dark) so the page follows the device. */
export const colours = {
  background: ['--color-bg', '#ffffff', '#0a0a0a'],
  surface: ['--color-surface', '#f5f5f5', '#141414'],
  text: ['--color-text', '#171717', '#ededed'],
  textSoft: ['--color-text-soft', '#525252', '#a3a3a3'],
  textOnAccent: ['--color-text-on-accent', '#ffffff', '#000000'],
  accent: ['--color-accent', '#171717', '#ff6a2b'],
  border: ['--color-border', '#737373', '#737373'],
  warning: ['--color-warning', '#955207', '#f5b94a'],
}

/** Shape: the control radius (buttons, inputs) and the banner radius (the warning box). */
export const radius = {
  control: ['--radius-md', '6px'],
  banner: ['--radius-lg', '10px'],
}

/** Font stack of the app. */
export const fontStack = ['--font-sans', "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans', 'Noto Sans Hebrew', Arial, sans-serif"]

/** Control height on every page (touch target). */
export const controlHeight = ['--control-h-md', '44px']
