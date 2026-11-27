# Draft history can be restored through the API

- An API client can restore an earlier version of its own draft. The restore is saved as a new version, and nothing is deleted.
- A draft that changed since the client read it is not restored (412). A published draft cannot be restored (409).

Area: Drafts
Link: https://github.com/Shaked/x-thread-draft-tool/pull/625

## Technical details

`POST /drafts/:id/revisions/:seq/restore` in `server/routes/revisions.js`: one UPDATE sets `last_actor_kind = 'restore'` and `last_label = 'Restored revision <seq>'`; images whose file is gone are dropped and counted. Implements #273 Task H6 (#379).
Screenshot: not needed, no screen changes.
