# The sign-in approval page follows the app's look

- The page that asks you to allow an AI app now uses the app's colours, corners and font, and follows your device's light or dark setting.
- Nothing else on the page changes: the wording, the warnings, the buttons' actions and the sign-out link stay the same.

Area: Design
Link: https://github.com/Shaked/x-thread-draft-tool/pull/574

## Technical details

`server/oauth/style.js` (new) copies the Rare-look token values the consent and device pages use, and `server/oauth/consent.js` builds its inline CSS from them. `tests/unit/oauth-style-tokens.test.js` checks each copied value against `src/styles/tokens.css`. `tests/e2e/screens.spec.ts` adds a dark-device consent scene.
