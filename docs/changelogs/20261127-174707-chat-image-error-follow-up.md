# Chat image errors name the right next step

- An AI app that sends an image in the chat gets the editor link for the draft, and an upload link only when one can add the image.
- URLs with a leading space or a missing slash are read the same way the server reads them.

Area: AI apps
Link: https://github.com/Shaked/x-thread-draft-tool/pull/611

## Technical details

Follow-up to #415 (PR 609). `add_image_from_url` checks the `url` with the server's URL parser (`isHttpUrl`, `server/mcp/tools.js`), builds the editor link from a draft the caller owns in `notPublicUrl`, and offers no upload link with `replace`. Tests: `tests/api/mcp-chat-image-error.test.js`. Screenshot: not needed, the change is text in an API error.
