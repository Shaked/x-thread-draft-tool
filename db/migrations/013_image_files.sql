-- Stored image bytes per user (#416): one row per uploaded image, so a user's total is a sum in the database
-- (a Blob listing stops at 1000 files). Rows go when the file is deleted; deleting the user removes the rest.
-- Additive and idempotent. No cap is enforced yet (owner question Q2 on #273).
create table if not exists image_files (
  url text primary key,
  user_id uuid not null references users(id) on delete cascade,
  bytes bigint not null check (bytes >= 0),
  created_at timestamptz not null default now()
);
create index if not exists image_files_user_idx on image_files (user_id);
