# Media Attachments

- Attach up to 4 images per post.
- Image handling for draft composition flows.
- Uploads go to `/api/images?draftId=...` as raw bytes (4 MB maximum) and are stored in Vercel Blob under `drafts/<user>/<draft>/`.
- Publishing or deleting a draft deletes its Blob images.
- Media-aware publish/archive behavior.
