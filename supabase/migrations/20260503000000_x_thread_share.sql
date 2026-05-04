-- Extend consume_share_token to also return author metadata so the
-- one-time X-thread HTML renderer can show the author's name, handle
-- and avatar (sourced from the OAuth provider via auth.users).
-- Idempotent: drops and recreates the function with the new signature.

drop function if exists public.consume_share_token(uuid);

create or replace function public.consume_share_token(p_token uuid)
returns table(
  title text,
  posts jsonb,
  author_name text,
  author_handle text,
  author_avatar text,
  created_at timestamptz
)
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
    select
      d.title,
      d.posts,
      coalesce(
        u.raw_user_meta_data->>'full_name',
        u.raw_user_meta_data->>'name',
        split_part(coalesce(u.email, ''), '@', 1)
      )::text as author_name,
      coalesce(
        u.raw_user_meta_data->>'user_name',
        u.raw_user_meta_data->>'preferred_username',
        split_part(coalesce(u.email, ''), '@', 1)
      )::text as author_handle,
      (u.raw_user_meta_data->>'avatar_url')::text as author_avatar,
      d.created_at
    from public.drafts d
    left join auth.users u on u.id = d.user_id
    where d.id = v_draft_id;
end;
$$;

revoke all on function public.consume_share_token(uuid) from public;
grant execute on function public.consume_share_token(uuid) to anon, authenticated, service_role;
