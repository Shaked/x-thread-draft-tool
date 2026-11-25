// The purple accent for the MCP views (#357). The values are copied from src/styles/tokens.css (--color-accent and
// --color-focus, light and dark). tests/unit/mcp-ui-tokens.test.js reads that file and fails when these copies drift.
// The views are separate HTML pages and cannot import the React styles, so the copy lives here.
export const ACCENT_LIGHT = { accent: '#6d28d9', focus: '#7c3aed' }
export const ACCENT_DARK = { accent: '#b69cff', focus: '#c4b0ff' }

const varsOf = (colors) => `--accent:${colors.accent};--focus:${colors.focus}`
export const ACCENT_VARS_LIGHT = varsOf(ACCENT_LIGHT)
export const ACCENT_VARS_DARK = varsOf(ACCENT_DARK)
