# Image cleanup checks run as one query

- Deciding whether an uploaded image is still in use now takes one database check, instead of reading every draft.
- Removing a post or an image with the AI app tools, deleting a draft and publishing keep any file that another draft of the same user still uses.

Area: Speed
Link: https://github.com/Shaked/x-thread-draft-tool/pull/152

## Technical details

- P8 (performance plan): deciding whether an uploaded image is still used now runs one SQL check, not a list of every draft. `DELETE /api/images` takes an optional `if_unused: true`, and `remove_post`, `remove_image`, draft delete and publish keep any file a draft of the same user still uses (also as plain text).
