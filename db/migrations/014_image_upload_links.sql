-- One-time upload links (#418): a link lets the owner add up to `slots` images to one post from any device.
-- Only the SHA-256 hash of the 32-byte token is stored. `used` counts the claimed slots.
-- Additive and idempotent. Rows go with the user or the draft; expired rows are removed by cleanupExpired.
create table if not exists image_upload_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  draft_id uuid not null references drafts(id) on delete cascade,
  post_id text not null,
  token_hash text not null unique,
  slots integer not null check (slots between 1 and 4),
  used integer not null default 0 check (used >= 0 and used <= slots),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists image_upload_links_user_idx on image_upload_links (user_id, created_at);
