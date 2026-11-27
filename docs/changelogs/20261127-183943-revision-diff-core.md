# Draft comparison core is ready, no visible change

- Nothing changes on screen yet. The app can now compare two draft versions, post by post and word by word.

Area: Drafts
Link: https://github.com/Shaked/x-thread-draft-tool/pull/615

## Technical details

`src/utils/revisionDiff.js` (task H4 of #273, issue #377): `diffDrafts`, `diffWords`, `applyDiff`, `summaryLine`. Shared by browser and server, no imports. Tests: `tests/unit/revision-diff.test.js` (500 seeded pairs with Hebrew, emoji, ZWJ, flags, combining marks, empty and long posts, reorders and a 1 MB draft; plus hand cases).
Word diff limits: the common start and end are removed first, on characters and cut back to a word start, so only the changed middle is segmented; a middle over 40,000 characters, over 2,000 tokens, or needing more than 1,000 edits is one deletion and one insertion, which still rebuilds both sides exactly. Null posts, missing text and ids that look alike (null, NaN, objects) are handled without throwing.
Screenshot: not needed, a pure module that no screen calls yet.
