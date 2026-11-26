# Media Attachments

- Attach up to 4 images per post.
- Image handling for draft composition flows.
- Uploads go to `/api/images?draftId=...` as raw bytes (4 MB maximum) and are stored in Vercel Blob under `drafts/<user>/<draft>/`.
- Publishing or deleting a draft deletes its Blob images.
- Media-aware publish/archive behavior.
- Image edits over REST and MCP (#412): `POST /api/drafts/:id/images` adds an image from a URL to a post at a place, or replaces one (`replace`); `POST .../posts/:postId/move` with `image_url` moves one; `DELETE /api/drafts/:id/images` removes one or all of a post. At most 4 per post; files no draft uses are deleted; a failed add deletes the new file. The editor has no image reorder or replace.
