# Draft summaries and outline (T4)

- `GET /api/drafts?view=summary` and MCP `list_drafts` (default `detail: "summary"`, `detail: "full"` for posts) return counts instead of post text.
- New `GET /api/drafts/:id/outline` and MCP `get_draft_outline`: per-post counts (280 limit) and a 40-character preview.
