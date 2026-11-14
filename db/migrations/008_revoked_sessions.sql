-- Sessions ended by sign-out (T3a). Additive and idempotent: safe to apply repeatedly.
-- A browser session token carries a random jti; once its jti is listed here the token is refused.
-- Rows are only needed until the token's own expiry, so sign-out removes the expired ones.

create table if not exists revoked_sessions (
  jti text primary key,
  expires_at timestamptz not null
);

create index if not exists revoked_sessions_expires_at_idx on revoked_sessions (expires_at);
