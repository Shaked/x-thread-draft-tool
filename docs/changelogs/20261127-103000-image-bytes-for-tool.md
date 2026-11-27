# add_image_from_url takes image bytes (#419)
- `add_image_from_url` accepts `data` (base64, at most 700,000 bytes) and `mime` instead of `url`, for our view and scripts; it calls `POST /images` in-process with raw bytes.
- Refused before any upload: over 933,336 characters, bad base64, a mime that differs from the bytes, `url` with `data`.
- `POST /drafts/:id/images` attaches a file the caller already owns without fetching it again.
