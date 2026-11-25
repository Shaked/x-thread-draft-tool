-- Observability plan O1 (#332): the metrics tables. Additive and idempotent: safe to apply repeatedly.
-- No foreign keys and no user id on purpose: a metric must outlive every user.
-- Nothing writes these tables yet (O2 records requests, O5 writes the daily step).

-- One row per (hour, route, op, caller) that had traffic. Status classes are counts, not key parts,
-- so a caller cannot multiply rows by choosing status codes. buckets: 65 counters, counter k at index k + 1.
create table if not exists metrics_hourly (
  hour timestamptz not null,
  route text not null,
  op text not null,
  caller text not null,
  n integer not null default 0,
  n_3xx integer not null default 0,
  n_4xx integer not null default 0,
  n_429 integer not null default 0,
  n_5xx integer not null default 0,
  n_tool_error integer not null default 0,
  sum_ms double precision not null default 0,
  max_ms double precision not null default 0,
  sum_db_ms double precision not null default 0,
  sum_q integer not null default 0,
  sum_conn integer not null default 0,
  cold integer not null default 0,
  buckets int[] not null check (array_lower(buckets, 1) = 1 and array_length(buckets, 1) = 65),
  primary key (hour, route, op, caller)
);

-- The same columns, one row per UTC day.
create table if not exists metrics_daily (
  day date not null,
  route text not null,
  op text not null,
  caller text not null,
  n integer not null default 0,
  n_3xx integer not null default 0,
  n_4xx integer not null default 0,
  n_429 integer not null default 0,
  n_5xx integer not null default 0,
  n_tool_error integer not null default 0,
  sum_ms double precision not null default 0,
  max_ms double precision not null default 0,
  sum_db_ms double precision not null default 0,
  sum_q integer not null default 0,
  sum_conn integer not null default 0,
  cold integer not null default 0,
  buckets int[] not null check (array_lower(buckets, 1) = 1 and array_length(buckets, 1) = 65),
  primary key (day, route, op, caller)
);

-- Product and security numbers, one row per UTC day. Per-day counts are counted from columns that
-- never change, so they are stored once. Rolling counts are read at taken_at and stay null when
-- taken_at is more than 6 hours after the end of the day.
create table if not exists metrics_product_daily (
  day date primary key,
  taken_at timestamptz not null default now(),
  signups integer not null default 0,
  drafts_created integer not null default 0,
  share_links_created integer not null default 0,
  tokens_created integer not null default 0,
  apps_connected integer not null default 0,
  admin_actions_done integer not null default 0,
  admin_actions_failed integer not null default 0,
  admin_actions_refused integer not null default 0,
  admin_actions_started integer not null default 0,
  admin_actions_gone integer not null default 0,
  active_users_24h integer,
  active_users_7d integer,
  suspended_users integer,
  db_bytes bigint
);

-- One row per alert kind, so an alert is sent once and not on every run.
create table if not exists metrics_alert_state (
  kind text primary key,
  first_seen timestamptz not null default now(),
  last_sent timestamptz,
  value double precision
);
