# AI apps without views get readable markdown

- `list_drafts` adds a table, `export_draft` a fenced block, `create_share_link` a link with its expiry; the JSON stays first.
- Images show as links only from our storage, and a quoted post only as an x.com or twitter.com status link; a long thread is cut at 8000 characters with the count left out.

Area: AI apps

## Technical details

`server/mcp/render/markdown.js` (new), `server/mcp/tools.js` (per-tool `markdown`), `server/mcp/thread-text.js`. Implements #273 Task 19.
