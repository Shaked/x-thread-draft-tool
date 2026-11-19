# MCP drafts list view (#182, T5)
- `list_drafts` now shows a drafts list view in hosts that support MCP Apps: one row per draft, "Open in editor", and "View thread" (calls `get_draft`, then the thread view).
- New view `ui://x-thread/drafts.html`; the thread view is unchanged. `content` and `structuredContent` are unchanged.
