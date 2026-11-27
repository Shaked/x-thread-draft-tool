# AI apps can show accounts and make threads

- AI apps can show the connected account, make a thread in one call, and remove an image.
- Adding an image from a link can now name the post it goes to.
- A test now fails when a route has no AI tool and is not skipped on purpose.

Area: AI apps
Link: https://github.com/Shaked/x-thread-draft-tool/pull/84

## Technical details

- MCP M4: whoami, create_thread_from_text and remove_image tools; add_image_from_url takes postId; a coverage test fails when a REST route has neither a tool nor an exclusion.
- Why: the connector could not show the account, make a thread in one call, or remove an image. Plan: docs/plans/mcp-clients.md (step M4).
