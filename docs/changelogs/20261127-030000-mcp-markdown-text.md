# AI apps without views get readable text

- The draft list, an export and a share link now come with plain readable text for AI apps that show no cards.
- Images show as links only from our own storage, and a long thread is cut at 8000 characters.

Area: AI apps
Link: https://github.com/Shaked/x-thread-draft-tool/pull/588

## Technical details

`server/mcp/render/markdown.js` (new), `server/mcp/tools.js` (per-tool `markdown`), `server/mcp/thread-text.js`. Implements #273 Task 19.
