# Draft comparison core is ready, no visible change

- Nothing changes on screen yet. The app can now compare two versions of a draft, post by post and word by word, and rebuild the newer one from the older one plus the difference.

Area: Drafts
Link: https://github.com/Shaked/x-thread-draft-tool/pull/615

## Technical details

`src/utils/revisionDiff.js` (task H4 of #273, issue #377): `diffDrafts`, `diffWords`, `applyDiff`, `summaryLine`. Shared by browser and server, no imports. Tests: `tests/unit/revision-diff.test.js` (500 seeded pairs with Hebrew, emoji, ZWJ, flags, combining marks, empty and long posts, reorders and a 1 MB draft; plus hand cases).
Screenshot: not needed, a pure module that no screen calls yet.
