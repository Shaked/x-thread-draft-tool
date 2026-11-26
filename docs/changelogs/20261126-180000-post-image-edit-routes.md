# One REST route for each post and image edit

- A script can now add, move and remove a post, and add, replace, move and remove an image, with one request each.
- The AI app tools use the same routes, so both follow the same rules (4 images per post, no edits to a published draft, a stale version is refused).

Area: AI apps
Link: https://github.com/Shaked/x-thread-draft-tool/issues/412

## Technical details

Implements #273 Task I2 and #412 Task 1. New `server/routes/draft-edits.js`; the MCP tools call it in-process.
