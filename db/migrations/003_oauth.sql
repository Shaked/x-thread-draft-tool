-- OAuth 2.1 authorization server tables (MCP connector and device flow).
-- Only SHA-256 hashes of codes and tokens are stored. Idempotent and additive only.

create table if not exists oauth_clients (
  client_id text primary key,              -- 'xtc_…' (registered), an https URL (metadata document) or 'device:<name>'
  kind text not null,                      -- 'registered' | 'metadata' | 'device'
  client_name text not null,
  redirect_uris text[] not null default '{}',
  metadata_fetched_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists oauth_grants (  -- one row per user, client and resource: a "Connected app"
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  client_id text not null references oauth_clients(client_id) on delete cascade,
  scope text not null,
  resource text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  unique (user_id, client_id, resource)
);

create table if not exists oauth_codes (
  code_hash text primary key,
  grant_id uuid not null references oauth_grants(id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  expires_at timestamptz not null,         -- 60 seconds after creation
  used_at timestamptz
);

create table if not exists oauth_tokens (
  token_hash text primary key,
  grant_id uuid not null references oauth_grants(id) on delete cascade,
  kind text not null,                      -- 'access' | 'refresh'
  expires_at timestamptz not null,
  used_at timestamptz,                     -- refresh tokens: set when rotated
  created_at timestamptz not null default now()
);
create index if not exists oauth_tokens_grant_idx on oauth_tokens(grant_id);
create index if not exists oauth_grants_user_idx on oauth_grants(user_id);
