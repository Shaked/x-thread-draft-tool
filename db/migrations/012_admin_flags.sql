-- Admin flags (#483): the admin's own feature-flag choices (look, components), kept on the account.
-- Additive and idempotent. Only the admin's row is ever written; the value of any other user is never read.
alter table users add column if not exists ui_flags jsonb not null default '{}'::jsonb;
