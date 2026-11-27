# Chat-only images get a clear next step

- When an AI app cannot send an image to a draft, it now gets the upload link and the editor link, not only a refusal.
- The message names the post, so the assistant can say which one to fill.

Area: AI apps
Link: https://github.com/Shaked/x-thread-draft-tool/pull/609

## Technical details

`add_image_from_url` checks the `url` before any upload (`server/mcp/tools.js`, `notPublicUrl`). Test: `tests/api/mcp-chat-image-error.test.js`. Screenshot: not needed, the change is a text in an API error.
