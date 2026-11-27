# Draft revisions (tables and trigger)

Built by E273 task H2 (#375, migration `db/migrations/015_draft_revisions.sql`); who is named by H3 (#376, below). Plan: `docs/plans/revisions-and-encryption.md` section 2. Only `server/routes/revisions.js` reads the tables (list and read one revision, #378); the history view and restore are later tasks. Checked on 2026-11-27.

## Tables
- `draft_revisions(draft_id, seq, version, created_at, actor_kind, actor_name, label, title, post_order)`, key `(draft_id, seq)`. `title` only when it changed; `post_order` (post ids) only when posts were added, removed or moved.
- `post_id` is a history key from `draft_post_keys()`: `i` + SHA-256 of the post id + `:` + the occurrence number of that id, or `n` + position for a post with no id. Fixed length (client ids are unbounded) and collision-free, so duplicate ids, odd ids and legacy posts are all kept.
- `draft_post_versions(draft_id, post_id, seq, body)`, key `(draft_id, post_id, seq)`. One row per changed post (the whole post object); `body` null means removed.
- `drafts.last_actor_kind`, `last_actor_name`, `last_label`: **one-shot.** A write sets them, the trigger reads them and then clears them on the row (a nested update with all three null). A later write that sets nothing has no actor and no label, so one label or one restore never carries over. Writes with no actor (all null) merge with each other within 2 minutes. Nullable; no existing row is rewritten.
- Both new tables reference `drafts` with `on delete cascade`, so they go with the draft and with the user. The admin delete-user preview counts them (`draft_revisions`, `revision_posts`).
- **They hold draft text** (titles, post bodies). The leak scan (`tests/api/plaintext-leak-scan.test.js`) lists them as draft tables; no log, error or admin answer may carry their text.
- No retention: every revision is kept (owner default for H1-Q1, 2026-11-27).

## Who is named (H3, #376)
Every write of `drafts` sets the one-shot columns in the same statement, from `actorOf(caller)` in `server/revision-actor.js` (no extra query):

| Caller | `actor_kind` | `actor_name` |
|---|---|---|
| Browser session | `user` | `Editor` |
| OAuth grant (MCP, or REST with an OAuth token) | `app` | the client's `client_name`, cleaned like `server/admin/clean.js`, at most 60 characters; `App` when empty or reserved |
| Personal API token | `app` | `API token` (never the token's own name) |
| CI identity (GitHub OIDC) | `system` | `CI` |
| One-time upload link (#418; `uploadLink` is set in server code only) | `app` | `Upload link` |
| Supabase import (`scripts/migrate-from-supabase.mjs`, `IMPORT_DRAFT_SQL`) | `system` | `Import` |

- Labels are fixed: publish sets `Published`; duplicate sets `Copied from another draft` on the copy. No label carries user text.
- A client whose name equals a fixed name (any case) is shown as `App`, so no client can pose as the browser, a token, CI, an upload link or the import.
- A publish that changes no post text or title writes no revision (rule 2 of the trigger), so `Published` is not shown then.
- A delete writes no revision: the cascade removes the history with the draft.
- Restore is not a writer yet; `restore` is reserved for it.

## Trigger `draft_revisions_trg` (after insert or update on drafts, per row)
0. The actor values are read and cleared first (also in rewrite mode).
1. `app.revision_mode = 'rewrite'` (set with `set local`): no revision.
2. Only `version`, flags or timestamps changed: no revision.
3. An old draft with no revisions: revision 0 (`system`, "Before history started") holds the old state first.
4. Same actor, no label, not a restore, last revision under 2 minutes old: the last revision is updated in place (new `version`, new bodies). Otherwise a new `seq`.
5. Changed posts get a row at that `seq`; removed posts get a null body.

Rebuild revision `n`: the newest non-null `post_order` at or before `n`, then the newest `body` per id at or before `n`.

Note for lock and encryption tasks: a rewrite that changes bodies without a revision means later revisions diff against the rewritten state; rebuilding an older revision gives the bodies as they were then.

The key function treats posts that are not a JSON array (a bad old row) as empty, so no write on such a row fails.

## Reading (`server/routes/revisions.js`, #378)
- `GET /drafts/:id/revisions?before=<seq>&limit=1..100`: one statement reads the page, the state just before its oldest revision and the post rows inside the page; the page is then replayed oldest to newest and each step is summarised with `summaryLine(diffDrafts(before, after))`.
- `GET /drafts/:id/revisions/:seq?against=<seq>|current`: one statement rebuilds the state at `seq` (and at `against`) as described above; `diff = diffDrafts(against, seq)`.
- Both use the shared, bounded `src/utils/revisionDiff.js`. Owner only (404 for anything else), 403 for view-as, two queries per call (the session check and the statement), no logging.
