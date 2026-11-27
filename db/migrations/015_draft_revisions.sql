-- Draft revisions (E273 task H2, #375). One revision row per write that changed posts or title, one row per
-- changed post. A trigger on drafts writes them inside the same statement, so every writer gets history.
-- Additive and idempotent. No existing draft row is rewritten. No retention: every revision is kept (#273 H1-Q1).
-- Rows hold draft text (post bodies, titles): they are draft tables for the leak scan and go with the draft.
-- A migration waits at most 5 s for a lock on drafts, so a deploy fails fast instead of hanging.
set local lock_timeout = '5s';

create table if not exists draft_revisions (
  draft_id uuid not null references drafts(id) on delete cascade,
  seq integer not null,
  version integer not null,
  created_at timestamptz not null default now(),
  actor_kind text,
  actor_name text,
  label text,
  title text,
  post_order text[],
  primary key (draft_id, seq)
);
create table if not exists draft_post_versions (
  draft_id uuid not null references drafts(id) on delete cascade,
  post_id text not null,
  seq integer not null,
  body jsonb,
  primary key (draft_id, post_id, seq)
);
alter table drafts add column if not exists last_actor_kind text;
alter table drafts add column if not exists last_actor_name text;
alter table drafts add column if not exists last_label text;

-- The history key of each post, fixed length and never colliding: 'i' + the SHA-256 of its id + ':' + the occurrence number
-- of that id (a repeated id counts up); a post with no id (saved before ids were required) gets 'n' + its position.
-- Client ids have no length limit, so they are hashed before they go into an index. Every post has its own key.
create or replace function draft_post_keys(posts jsonb) returns table (key text, ord bigint, body jsonb)
language sql stable set search_path = pg_catalog, public as $$
  select case when e.value->>'id' is null then 'n' || e.ord
              else 'i' || encode(sha256(convert_to(e.value->>'id', 'UTF8')), 'hex') || ':'
                   || row_number() over (partition by e.value->>'id' order by e.ord) end,
         e.ord, e.value
    from jsonb_array_elements(case when jsonb_typeof(posts) = 'array' then posts else '[]'::jsonb end) with ordinality as e(value, ord)
$$;

-- The actor columns on drafts are one-shot: a write sets them, this trigger reads them, then clears them on the row, so
-- the next write that sets nothing is not labelled with the previous actor, label or restore.
create or replace function draft_revisions_write() returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare
  old_posts jsonb := case when TG_OP = 'INSERT' then '[]'::jsonb else OLD.posts end;
  old_ids text[];
  new_ids text[];
  title_changed boolean := TG_OP = 'INSERT' or NEW.title is distinct from OLD.title;
  actor_kind text := NEW.last_actor_kind;
  actor_name text := NEW.last_actor_name;
  label text := NEW.last_label;
  last_rev draft_revisions%rowtype;
  target integer;
begin
  -- One-shot actor: clear what this write set. The nested update has all three null, so it stops there.
  if actor_kind is not null or actor_name is not null or label is not null then
    update drafts set last_actor_kind = null, last_actor_name = null, last_label = null where id = NEW.id;
  end if;

  -- Lock, unlock and the encryption batches rewrite posts without being an edit: no revision (plan 3.7).
  if current_setting('app.revision_mode', true) = 'rewrite' then
    return null;
  end if;

  -- Only version, flags or timestamps changed: no revision (checked before any key is computed).
  if not (title_changed or old_posts is distinct from NEW.posts) then
    return null;
  end if;

  -- Post keys in order, old and new. A change of keys, or of their order, is what post_order records.
  old_ids := coalesce(array(select key from draft_post_keys(old_posts) order by ord), '{}');
  new_ids := coalesce(array(select key from draft_post_keys(NEW.posts) order by ord), '{}');

  -- An old draft with no history: store its state first as revision 0 (nothing existing is rewritten).
  if TG_OP = 'UPDATE' and not exists (select 1 from draft_revisions where draft_id = NEW.id) then
    insert into draft_revisions (draft_id, seq, version, actor_kind, actor_name, label, title, post_order)
    values (NEW.id, 0, OLD.version, 'system', null, 'Before history started', OLD.title, old_ids);
    insert into draft_post_versions (draft_id, post_id, seq, body)
    select NEW.id, key, 0, k.body from draft_post_keys(OLD.posts) k;
  end if;

  -- Merge into the last revision: same actor, no label, a user edit (not a restore), under 2 minutes old.
  select * into last_rev from draft_revisions where draft_id = NEW.id order by seq desc limit 1;
  if found and actor_kind is distinct from 'restore' and last_rev.label is null and label is null
     and last_rev.actor_kind is not distinct from actor_kind
     and last_rev.actor_name is not distinct from actor_name
     and last_rev.created_at > now() - interval '2 minutes' then
    target := last_rev.seq;
    update draft_revisions
       set version = NEW.version,
           title = case when title_changed then NEW.title else title end,
           post_order = case when old_ids is distinct from new_ids then new_ids else post_order end
     where draft_id = NEW.id and seq = target;
  else
    target := coalesce(last_rev.seq, 0) + 1;
    insert into draft_revisions (draft_id, seq, version, actor_kind, actor_name, label, title, post_order)
    values (NEW.id, target, NEW.version, actor_kind, actor_name, label,
            case when title_changed then NEW.title end,
            case when old_ids is distinct from new_ids then new_ids end);
  end if;

  -- One row per changed post (the whole post object), and a null body for each removed post.
  insert into draft_post_versions (draft_id, post_id, seq, body)
  select NEW.id, n.id, target, n.body
    from draft_post_keys(NEW.posts) n(id, ord, body)
    left join draft_post_keys(old_posts) o(id, ord, body) on o.id = n.id
   where o.body is distinct from n.body
  union all
  select NEW.id, o.id, target, null
    from draft_post_keys(old_posts) o(id, ord, body)
   where o.id <> all(new_ids)
  on conflict (draft_id, post_id, seq) do update set body = excluded.body;
  return null;
end;
$$;

create or replace trigger draft_revisions_trg after insert or update on drafts
  for each row execute function draft_revisions_write();
