# Tests: update_draft shows the card with all 7 posts

- `update_draft` already has the thread view with the full posts (it came with the edit-result work in #405). Two tests now pin it: 1 post saved, then 7 posts.

Area: MCP views
Link: https://github.com/Shaked/x-thread-draft-tool/issues/392

## Technical details

`tests/api/mcp-ui.test.js` (7 posts with full text in `x-thread/posts`, new version, markdown part reads back) and one new scene in `tests/e2e/mcp-thread-view.spec.ts` (card says "7 posts", 7 articles). No product code changed. Implements #392 (W5).
