# Draft history can be restored through the API

- An API client can restore an earlier version of its own draft. The restore is saved as a new version; nothing is deleted, and a restore can be undone by restoring again.
- A restore on a draft that changed since the client read it is refused (412), and a published draft cannot be restored (409).

Area: Drafts
Link: https://github.com/Shaked/x-thread-draft-tool/issues/379

## Technical details

`POST /drafts/:id/revisions/:seq/restore` in `server/routes/revisions.js`: one UPDATE sets `last_actor_kind = 'restore'` and `last_label = 'Restored revision <seq>'`; images whose file is gone are dropped and counted. Implements #273 Task H6 (#379).
Screenshot: not needed, no screen changes.
