# AI apps and the API get draft summaries

- The draft list can return post counts instead of full post text. The AI app draft list does this by default.
- A new outline shows each post's character count against the 280 limit and the first 40 characters.

Area: AI apps
Link: https://github.com/Shaked/x-thread-draft-tool/pull/124

## Technical details

# Draft summaries and outline (T4)

- `GET /api/drafts?view=summary` and MCP `list_drafts` (default `detail: "summary"`, `detail: "full"` for posts) return counts instead of post text.
- New `GET /api/drafts/:id/outline` and MCP `get_draft_outline`: per-post counts (280 limit) and a 40-character preview.
