-- Personal API tokens for agents. Only the SHA-256 hash of each token is stored.
-- Idempotent and additive only.
create table if not exists api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  token_prefix text not null,          -- first 10 chars, e.g. "xt_AbC1234", for display only
  created_via text not null default 'web', -- 'web' | 'device'
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
);
create index if not exists api_tokens_user_id_idx on api_tokens(user_id);
