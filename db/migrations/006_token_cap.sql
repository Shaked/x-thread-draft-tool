-- Caps existing hand-made xt_ tokens at 7 days from creation (plan D4, Task 7.9).
-- Old expiries are saved in api_token_cap_backup first. Idempotent: a second run changes nothing.
create table if not exists api_token_cap_backup (
  token_id uuid primary key references api_tokens(id) on delete cascade,
  expires_at timestamptz,
  capped_at timestamptz not null default now()
);

insert into api_token_cap_backup (token_id, expires_at)
  select id, expires_at from api_tokens
   where revoked_at is null
     and (expires_at is null or expires_at > created_at + interval '7 days')
on conflict (token_id) do nothing;

update api_tokens
   set expires_at = created_at + interval '7 days'
 where revoked_at is null
   and (expires_at is null or expires_at > created_at + interval '7 days');

do $$
begin
  if exists (select 1 from api_tokens
              where revoked_at is null
                and (expires_at is null or expires_at > created_at + interval '7 days'))
  then
    raise exception 'token cap not applied';
  end if;
end $$;
