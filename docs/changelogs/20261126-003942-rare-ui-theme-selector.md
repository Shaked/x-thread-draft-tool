# Try the real Rare UI theme picker

- Feature flags has a new Components switch: with it on, the theme choice in the menu shows a small preview of each theme.
- The previews follow the purple or the Rare UI look, in light and dark.
- The switch stays on this device only.

Area: Design
Link: https://github.com/Shaked/x-thread-draft-tool/pull/468

## Technical details

Rare UI theme-selector copied into src/ui/rare/ThemeSelector.jsx (upstream commit 0e9f0ef), Tailwind 4 utilities only (@tailwindcss/vite 4.3.5, src/styles/rare-kit.css), flag xt-kit in src/utils/skin.js, wrapper src/ui/ThemePicker.jsx, [data-color-scope] in tokens.css, Tailwind rules in the token lint.
