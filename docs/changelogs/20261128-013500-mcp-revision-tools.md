# AI apps can read and restore draft history
- An AI app can list the history of a draft, see what each change did, and go back to an earlier version.
- Going back needs the current version of the draft and keeps the older history.
Area: AI apps
Link: https://github.com/Shaked/x-thread-draft-tool/pull/627
Screenshot: not needed, tool text only

## Technical details
Tools `list_revisions`, `get_revision` and `restore_revision` in `server/mcp/tools.js`; text in `server/mcp/revision-result.js`. Implements #273 Task H7.
