-- Draft version for optimistic concurrency (O1, per-post PATCH with If-Match). Additive and idempotent.
-- Every write to a draft row increments it (see server/routes/drafts.js).

alter table drafts add column if not exists version integer not null default 1;
