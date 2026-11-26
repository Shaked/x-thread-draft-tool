# Tests: a rewritten draft shows all its posts in the card

- When an AI app rewrites a 1-post draft as 7 posts, the card now has tests that check it shows all 7 posts.

Area: AI apps
Link: https://github.com/Shaked/x-thread-draft-tool/pull/548

## Technical details

`tests/api/mcp-ui.test.js` and one new scene in `tests/e2e/mcp-thread-view.spec.ts` cover `update_draft` with 7 posts. No product code changed. Implements #392 (W5).
