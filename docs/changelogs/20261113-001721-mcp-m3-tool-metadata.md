# AI apps get clearer tool details and links

- Every tool has a title and four hints that tell AI apps which actions need a confirmation.
- Share links come with a preview link and a Markdown link.
- Draft results include a link to the editor.

Area: AI apps
Link: https://github.com/Shaked/x-thread-draft-tool/pull/83

## Technical details

- MCP M3: every tool has a title and the four annotation hints; share links come as preview_url and markdown_url; draft results carry the editor link (url).
- Why: ChatGPT and Claude use the hints to decide what needs confirmation, and a bare token is not a link. Plan: docs/plans/mcp-clients.md (step M3).
