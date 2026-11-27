# Media Attachments

- Attach up to 4 images per post.
- Image handling for draft composition flows.
- Uploads go to `/api/images?draftId=...` as raw bytes (4 MB maximum) and are stored in Vercel Blob under `drafts/<user>/<draft>/`.
- Publishing or deleting a draft deletes its Blob images.
- Media-aware publish/archive behavior.
- Image edits over REST and MCP (#412): `POST /api/drafts/:id/images` adds an image from a URL to a post at a place, or replaces one (`replace`); `POST .../posts/:postId/move` with `image_url` moves one; `DELETE /api/drafts/:id/images` removes one or all of a post. At most 4 per post; files no draft uses are deleted; a failed add deletes the new file. The editor has no image reorder or replace.
- Safe uploads (#416): on every upload route the type comes from the first bytes (PNG, JPEG, WebP, GIF), the `Content-Type` header is ignored, SVG and anything else is refused with a 415 that names the types that work. EXIF, XMP and text chunks are removed in plain JS (JPEG keeps only Orientation). Each stored file is counted per user in `image_files`; the admin user page and `admin_get_user` show `stored_bytes`. Files uploaded before this change are not counted (no backfill). No storage cap yet (owner question Q2 on #273).
- One-time upload link (#418, plan 4.2): `add_image_from_url` with `upload_link: true` and `postId`, or `POST /api/drafts/:id/posts/:postId/upload-links`, makes a link `/upload#<token>` for the free slots of one post (30 minutes, 10 links per hour). Only the token's hash is stored (`image_upload_links`). The page needs no sign-in, shows only the post number, the free slots and its own thumbnails, and sends the token as a bearer token to `POST /api/upload-links/images` (same checks as `POST /api/images`). A slot is claimed in one statement and given back if the upload fails; a dead link answers 410. `/upload` sends `Referrer-Policy: no-referrer`.
