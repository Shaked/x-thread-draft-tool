# Image removal through AI apps fixed

- Removing an image now counts how many other drafts use it.
- Only files owned by your account are deleted.
- A successful removal no longer returns a forbidden error.

Area: AI apps
Link: https://github.com/Shaked/x-thread-draft-tool/pull/84

## Technical details

- MCP M4 fix: remove_image counts string-form image references in other drafts, and deletes only the caller's own files (no 403 after a successful removal).
- Why: Codex review of 5c79609 found both. Plan: docs/plans/mcp-clients.md (step M4).
