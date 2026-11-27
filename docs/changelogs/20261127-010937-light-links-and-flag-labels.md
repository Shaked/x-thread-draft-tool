# Links in the light look keep their underline, and the admin look labels are shorter

- Tweet-embed error links are underlined in the light look; the admin switch labels are now "Purple (only you)" and "Plain components (only you)".

Area: Design
Link: https://github.com/Shaked/x-thread-draft-tool/pull/TBD

## Technical details

`src/styles/App.css` (`.tweet-embed-error a`: underline, `--hit-min` height); `src/pages/admin/AdminFlagsPage.jsx` labels, with their tests and the feature docs. `tests/e2e/ui-audit.spec.ts`: every page in MIGRATED fails on a visible link that has the body text colour and no underline, and the flags Look options must be at most 44 px tall on a phone (fails on main first).
