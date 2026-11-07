-- Initial schema for the Neon Postgres database.
-- Idempotent and additive only: safe to apply repeatedly. No destructive statements.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  github_id bigint not null unique,
  login text not null,
  name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null default '',
  posts jsonb not null default '[]'::jsonb,
  is_published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists drafts_user_published_idx on drafts(user_id, is_published);

create table if not exists share_tokens (
  token uuid primary key default gen_random_uuid(),
  draft_id uuid not null references drafts(id) on delete cascade,
  created_by uuid not null references users(id) on delete cascade,
  used boolean not null default false,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists share_tokens_draft_id_idx on share_tokens(draft_id);
