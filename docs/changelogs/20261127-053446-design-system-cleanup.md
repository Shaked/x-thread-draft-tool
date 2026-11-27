# Old style rules removed, almost no change on screen

- The last leftover style file and the old colour and size names are gone; every page now uses the shared design values.
- On phones, pages start 1 pixel lower and the side space is 1 pixel wider than before.
- At a window width of exactly 768 pixels the phone layout no longer applies; it now ends one pixel earlier, like the rest of the app.

Area: Design
Link: https://github.com/Shaked/x-thread-draft-tool/pull/596

## Technical details

Plan `docs/plans/ui-design-system.md` Task 13 (#329). `src/styles/App.css` is deleted; the rules still in use moved to `src/App.css`, tokens only (new token `--app-w` keeps the 1400 px cap; the editor focus rule is kept). The alias block, the `--legacy-*` sizes and the dead classes are gone. `LEGACY` left `tests/unit/design-tokens.test.js`, which now also fails on an old variable name. Breakpoint `max-width: 768px` became `width < 768px`; 15 px padding became `--space-4`.
