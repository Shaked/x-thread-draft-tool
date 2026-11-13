-- Tool-call rate limit for POST /api/mcp (plan M8). One row per user and minute. Idempotent and additive.
-- Rows older than one day are deleted by cleanupExpired (server/oauth/tokens.js).

create table if not exists mcp_rate_limits (
  user_id uuid not null references users(id) on delete cascade,
  minute timestamptz not null,
  calls integer not null default 0,
  primary key (user_id, minute)
);
