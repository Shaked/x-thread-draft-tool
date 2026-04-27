-- One-time agent share tokens.
-- Idempotent: safe to apply repeatedly. Additive only.

create extension if not exists "pgcrypto";

create table if not exists public.share_tokens (
  token uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.drafts(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  used boolean not null default false,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists share_tokens_draft_id_idx on public.share_tokens(draft_id);
create index if not exists share_tokens_created_by_idx on public.share_tokens(created_by);

alter table public.share_tokens enable row level security;

-- Owners can see their own tokens (for debugging in the dashboard).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'share_tokens' and policyname = 'share_tokens_owner_select'
  ) then
    create policy share_tokens_owner_select on public.share_tokens
      for select using (auth.uid() = created_by);
  end if;
end$$;

-- All other access (insert/update/delete) goes through the security-definer functions below.

create or replace function public.create_share_token(p_draft_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_owner uuid;
  v_token uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select user_id into v_owner from public.drafts where id = p_draft_id;
  if v_owner is null then
    raise exception 'draft not found';
  end if;
  if v_owner <> v_user_id then
    raise exception 'not authorized';
  end if;

  insert into public.share_tokens(draft_id, created_by)
  values (p_draft_id, v_user_id)
  returning token into v_token;

  return v_token;
end;
$$;

revoke all on function public.create_share_token(uuid) from public;
grant execute on function public.create_share_token(uuid) to authenticated;

-- Atomically consumes a token: marks it used and returns the draft payload.
-- Returns NULL if token is missing or already used.
create or replace function public.consume_share_token(p_token uuid)
returns table(title text, posts jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft_id uuid;
begin
  update public.share_tokens
     set used = true, used_at = now()
   where token = p_token
     and used = false
  returning draft_id into v_draft_id;

  if v_draft_id is null then
    return;
  end if;

  return query
    select d.title, d.posts
      from public.drafts d
     where d.id = v_draft_id;
end;
$$;

revoke all on function public.consume_share_token(uuid) from public;
grant execute on function public.consume_share_token(uuid) to anon, authenticated, service_role;

-- Trivial RPC used by the keep-alive workflow. Hitting /rest/v1/ returns
-- a cached OpenAPI schema that doesn't count as database activity; this
-- function executes a real SQL statement so the project stays unpaused.
create or replace function public.keepalive()
returns timestamptz
language sql
security definer
set search_path = public
as $$
  select now();
$$;

revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated, service_role;
