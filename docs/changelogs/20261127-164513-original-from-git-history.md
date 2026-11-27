# Five older changelog entries can now be rewritten

- The old-entry rewrite script can now read the original text of five more entries.
- No change for people using the app.

Area: Docs
Link: https://github.com/Shaked/x-thread-draft-tool/pull/608

## Technical details

`originalFromGit` in `scripts/changelog-rewrite.mjs` reads the newest version on the base branch without the rewrite heading. Two entries were added in a merge, and three were edited after they were added. Test: `tests/unit/changelog-rewrite.test.js`.
