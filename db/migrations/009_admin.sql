-- Admin plan A1. Additive and idempotent: safe to apply repeatedly.
alter table users add column if not exists suspended_at timestamptz;
alter table users add column if not exists suspended_reason text;
alter table oauth_grants add column if not exists admin_until timestamptz;
alter table oauth_grants add column if not exists admin_pending_hash text;
alter table oauth_grants add column if not exists admin_pending_until timestamptz;
alter table oauth_grants add column if not exists admin_pending_tries integer not null default 0;
-- No foreign keys on purpose: a row must survive the deletion of the user it names.
create table if not exists admin_audit (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_user_id uuid not null,
  actor_github_id bigint not null,
  actor_login text not null,
  action text not null,
  outcome text not null,
  target_user_id uuid,
  target_github_id bigint,
  target_login text,
  details jsonb not null default '{}'::jsonb
);
create index if not exists admin_audit_created_idx on admin_audit(created_at desc);
