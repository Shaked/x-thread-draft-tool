# Draft history now names who made each change

- Each saved change to a draft records who made it: you in the browser, an app by its name, an API token, the import, or a one-time upload link.
- Publishing and duplicating are labelled in the history.

Area: Drafts
Link: https://github.com/Shaked/x-thread-draft-tool/pull/627

## Technical details

`actorOf(caller)` in `server/revision-actor.js`; every write of `drafts` sets `last_actor_kind` and `last_actor_name` in the same statement. Reserved names map to `App`. Import SQL exported as `IMPORT_DRAFT_SQL`. Implements #273 Task H3 (#376).
Screenshot: not needed, no screen changes.
