# AI apps edit first, then show a shorter reply

- AI apps change a draft at once when asked, then say in one line what changed.
- Options and before-and-after text come back as numbered quotes, and the saved thread is not repeated when a card shows it.

Area: AI apps
Link: https://github.com/Shaked/x-thread-draft-tool/pull/578

## Technical details

`server/mcp/server.js` (instructions), `server/mcp/prompts.js` (rewrite_hook, tighten_draft, thread_from_notes), `server/mcp/skills.js` ("Working on a draft", workflow steps 1 and 2). Tests in `tests/api/mcp-default-use.test.js`, `mcp-prompts.test.js`, `mcp-skills.test.js`. Discovery score and `baseline.json` unchanged. Implements #388.
