# Hebrew share header and About credit read in the right order

- Hebrew share pages show "@handle · date" in order, not "26/11/2026@", and the Hebrew Rare UI credit link stays on one line.

Area: Design
Link: https://github.com/Shaked/x-thread-draft-tool/pull/567

## Technical details

`server/share/render.js` puts `dir="ltr"` on the handle-and-date span (unit test in `tests/unit/render.test.ts`, which fails on main). `src/pages/AboutPage.jsx` gives the Hebrew credit link `dir="ltr"` and `white-space: nowrap`; measured at 390 px light, the link box went from 44 px (two lines) to 20 px (one line).
