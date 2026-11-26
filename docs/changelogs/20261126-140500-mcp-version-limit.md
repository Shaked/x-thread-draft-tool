# AI apps get a clear answer for a draft version that is too large

- When an AI app sends an impossibly large draft version, it now gets a plain error that names the limit.

Area: AI apps
Link: https://github.com/Shaked/x-thread-draft-tool/pull/0

## Technical details

`VERSION` in `server/mcp/tools.js` gets `maximum: 2147483647`. Test in `tests/api/mcp-edit-result.test.js`. Implements #474 Task 4.
