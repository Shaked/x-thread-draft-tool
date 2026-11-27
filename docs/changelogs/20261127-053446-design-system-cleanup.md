# Old style rules removed, no change on screen

- The last leftover style file and the old colour and size names are gone; every page now uses the shared design values.
- On phones the editor page starts 1 pixel lower than before.

Area: Design
Link: https://github.com/Shaked/x-thread-draft-tool/pull/596

## Technical details

Plan `docs/plans/ui-design-system.md` Task 13 (#329). `src/styles/App.css` is deleted; the rules still in use moved to `src/App.css`, tokens only. The alias block, the `--legacy-*` sizes and the dead classes are gone. `LEGACY` left `tests/unit/design-tokens.test.js`, which now also fails on an old variable name.
