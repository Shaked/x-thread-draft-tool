-- Performance metrics ingest table.
-- Receives client-collected events (pageviews, vitals, snapshots, longtasks)
-- via direct PostgREST insert with the anon key. No SELECT policy: nobody
-- reads via the API. The token-gated /metrics Edge Function reads aggregates
-- through metrics_summary() (security definer, service_role only).
-- Idempotent: safe to apply repeatedly. Additive only.

create table if not exists public.metrics_events (
  id           bigserial primary key,
  created_at   timestamptz not null default now(),
  session_id   uuid not null,
  user_id      uuid references auth.users(id) on delete set null,
  event_type   text not null,
  url_path     text,
  payload      jsonb not null default '{}'::jsonb,
  user_agent   text
);

create index if not exists metrics_events_created_at_idx
  on public.metrics_events (created_at desc);
create index if not exists metrics_events_event_type_idx
  on public.metrics_events (event_type);
create index if not exists metrics_events_session_id_idx
  on public.metrics_events (session_id);

alter table public.metrics_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'metrics_events'
      and policyname = 'metrics_insert_any'
  ) then
    create policy metrics_insert_any on public.metrics_events
      for insert to anon, authenticated with check (true);
  end if;
end$$;
