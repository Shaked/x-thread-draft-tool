# Edits to different posts are now merged

- If an AI app changes one post while you edit another, both changes are kept and you see a short note.
- The conflict banner now shows only when you and the other app changed the same post.

Area: Editor
Link: https://github.com/Shaked/x-thread-draft-tool/pull/541

## Technical details

`src/utils/draftMerge.js` (pure) and the 412 handler in `src/pages/DraftEditor.jsx`. Merges only when the sides changed different posts, at most one changed the title, and at most one added, removed or moved posts. A 412 of the merged save shows the banner. Tests: `tests/unit/draftMerge.test.js`, `tests/unit/DraftEditor.merge.test.jsx`, `tests/e2e/draft-conflict-banner.spec.ts`. Implements #474 Task 1.
