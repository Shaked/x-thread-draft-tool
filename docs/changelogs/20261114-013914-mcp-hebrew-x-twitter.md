# AI apps recognize Hebrew and X requests

- The tool descriptions and server instructions for AI apps now include Hebrew and X (Twitter) trigger words.
- The publish tool says it posts nothing to X.

Area: AI apps
Link: https://github.com/Shaked/x-thread-draft-tool/pull/106

## Technical details

MCP tool descriptions and server instructions now carry Hebrew and X/Twitter trigger words (plan Task 13a); `publish_draft` says it posts nothing to X/Twitter.
Adds `server/mcp/language.js` (clean-text check), `tests/api/mcp-language.test.js` and a Hebrew section in `docs/agents/mcp.md`.
