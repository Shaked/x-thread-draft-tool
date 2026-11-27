# Draft revisions (tables and trigger)

Built by E273 task H2 (#375, migration `db/migrations/015_draft_revisions.sql`). Plan: `docs/plans/revisions-and-encryption.md` section 2. Nothing reads the tables yet (history view and restore are later tasks). Checked on 2026-11-27.

## Tables
- `draft_revisions(draft_id, seq, version, created_at, actor_kind, actor_name, label, title, post_order)`, key `(draft_id, seq)`. `title` only when it changed; `post_order` (post ids) only when posts were added, removed or moved.
- `post_id` is a history key from `draft_post_keys()`: the post id; a repeated id gets `<id>\x1f<occurrence>`; a post with no id gets `\x1fpos<position>`. So duplicate ids and legacy posts are all kept.
- `draft_post_versions(draft_id, post_id, seq, body)`, key `(draft_id, post_id, seq)`. One row per changed post (the whole post object); `body` null means removed.
- `drafts.last_actor_kind`, `last_actor_name`, `last_label`: set by a write, read by the trigger. Nullable; no existing row is rewritten.
- Both new tables reference `drafts` with `on delete cascade`, so they go with the draft and with the user. The admin delete-user preview counts them (`draft_revisions`, `revision_posts`).
- **They hold draft text** (titles, post bodies). The leak scan (`tests/api/plaintext-leak-scan.test.js`) lists them as draft tables; no log, error or admin answer may carry their text.
- No retention: every revision is kept (owner default for H1-Q1, 2026-11-27).

## Trigger `draft_revisions_trg` (after insert or update on drafts, per row)
1. `app.revision_mode = 'rewrite'` (set with `set local`): no revision.
2. Only `version`, flags or timestamps changed: no revision.
3. An old draft with no revisions: revision 0 (`system`, "Before history started") holds the old state first.
4. Same actor, no label, not a restore, last revision under 2 minutes old: the last revision is updated in place (new `version`, new bodies). Otherwise a new `seq`.
5. Changed posts get a row at that `seq`; removed posts get a null body.

Rebuild revision `n`: the newest non-null `post_order` at or before `n`, then the newest `body` per id at or before `n`.

Note for lock and encryption tasks: a rewrite that changes bodies without a revision means later revisions diff against the rewritten state; rebuilding an older revision gives the bodies as they were then.
