-- Share link expiry and reuse (T2). Additive and idempotent: safe to apply repeatedly.
-- A row with no expires_at expires one hour after it was created (see server/routes/share.js).

alter table share_tokens add column if not exists expires_at timestamptz;
alter table share_tokens add column if not exists one_time boolean not null default true;
