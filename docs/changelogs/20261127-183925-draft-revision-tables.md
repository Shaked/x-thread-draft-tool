# Draft history is now recorded

- No visible change yet: the database now keeps one revision per saved change to a draft's posts or title.
- Nothing is deleted automatically; every revision is kept.

Area: Drafts
Link: https://github.com/Shaked/x-thread-draft-tool/pull/616

## Technical details

Migration `015_draft_revisions.sql` (E273 task H2, #375): tables `draft_revisions` and `draft_post_versions`, columns `drafts.last_actor_kind`, `last_actor_name`, `last_label`, and the trigger `draft_revisions_trg`. The trigger runs in the same statement as the write, so the query budget is unchanged. `set local app.revision_mode = 'rewrite'` skips it (lock, unlock, encryption batches). The admin delete-user counts gain `draft_revisions` and `revision_posts`. The leak scan allows both tables as draft-text tables.
