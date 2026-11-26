-- Central metrics plan M1 (#439, task #447): the ops events tables. Additive and idempotent.
-- No foreign keys and no user id on purpose: an event must outlive every user.
-- Nothing writes these tables yet (M2 adds the ingest route, M3 the collector).

-- One row per event: a CI run, a merge, a speed stage, a deploy or a production error.
-- Fixed fields only. attrs holds the few keys that server/ops/events.js lists for each kind.
-- unique (repo_id, source, kind, id): a late or repeated event is ignored by the insert, not stored twice.
create table if not exists ops_events (
  repo_id bigint not null,
  source text not null,
  kind text not null,
  id text not null,
  at timestamptz not null,
  name text not null,
  status text not null,
  ms integer,
  attrs jsonb not null default '{}'::jsonb,
  link text,
  unique (repo_id, source, kind, id)
);

create index if not exists ops_events_repo_source_at on ops_events (repo_id, source, at);

-- Counters per finished UTC day: skipped and cancelled runs, and runs of unlisted workflows.
-- The collector replaces a finished day's rows, so a repeated run never counts twice.
create table if not exists ops_daily (
  day date not null,
  repo_id bigint not null,
  source text not null,
  kind text not null,
  name text not null,
  status text not null,
  count integer not null default 0,
  primary key (day, repo_id, source, kind, name, status)
);

-- The collector's position per repo: the time it has read up to. Returned in every answer of the ingest route.
create table if not exists ops_cursor (
  repo_id bigint primary key,
  completed_at timestamptz not null
);
