# UI 12: OAuth consent pages use the design tokens
- `server/oauth/style.js` (new) copies the few Rare-look token values the consent pages use; `consent.js` builds its inline CSS from them (light and dark, follows the device, 44 px buttons). Every check (site name, Origin, CSP, copy script) is unchanged.
