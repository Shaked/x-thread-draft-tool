-- Aggregation views and the single function the /metrics Edge Function calls.
-- Views are convenience for ad-hoc dashboard queries. metrics_summary() is the
-- only entry point reachable from the API, and only via service_role.
-- Idempotent: safe to apply repeatedly. Additive only.

-- UA family classification used across views. Strips PII (full UA string never
-- returned by metrics_summary).
create or replace function public.metrics_ua_family(p_ua text)
returns text
language sql immutable parallel safe as $$
  select case
    when p_ua is null then 'unknown'
    when p_ua ~* 'iphone|ipad|ipod' and p_ua ~* 'crios' then 'ios_chrome'
    when p_ua ~* 'iphone|ipad|ipod' and p_ua ~* 'fxios' then 'ios_firefox'
    when p_ua ~* 'iphone|ipad|ipod' then 'ios_safari'
    when p_ua ~* 'android' then 'android'
    when p_ua ~* 'macintosh' then 'desktop_mac'
    when p_ua ~* 'windows' then 'desktop_windows'
    when p_ua ~* 'linux' then 'desktop_linux'
    else 'other'
  end;
$$;

-- Type-safe JSONB extractors. The metrics_events table is anon-insertable
-- (necessary for the client-side beacon), so payloads can contain anything.
-- A naive cast like (payload->>'flag')::boolean throws on garbage input,
-- which would make metrics_summary fail and brick the /metrics endpoint
-- after a single malformed (or malicious) row. These helpers return a
-- default for any value whose JSONB type doesn't match.
create or replace function public.metrics_jb_bool(j jsonb, k text)
returns boolean
language sql immutable parallel safe as $$
  select case when jsonb_typeof(j->k) = 'boolean'
              then (j->>k)::boolean
              else false end;
$$;

create or replace function public.metrics_jb_num(j jsonb, k text)
returns numeric
language sql immutable parallel safe as $$
  select case when jsonb_typeof(j->k) = 'number'
              then (j->>k)::numeric
              else null end;
$$;

-- Daily volume + eviction rate by UA family.
create or replace view public.metrics_pageviews_daily as
select
  date_trunc('day', created_at) as day,
  public.metrics_ua_family(user_agent) as ua_family,
  count(*) as pageviews,
  count(*) filter (where metrics_jb_bool(payload, 'likelyEvicted')) as evictions,
  count(*) filter (where metrics_jb_bool(payload, 'bfcacheRestored')) as bfcache_restores,
  count(distinct session_id) as sessions
from public.metrics_events
where event_type = 'pageview'
group by 1, 2;

-- Web Vitals percentiles per day + UA family.
create or replace view public.metrics_vitals_p75_p95 as
select
  date_trunc('day', created_at) as day,
  public.metrics_ua_family(user_agent) as ua_family,
  payload->>'name' as metric,
  count(*) as samples,
  percentile_cont(0.75) within group (order by (payload->>'value')::numeric) as p75,
  percentile_cont(0.95) within group (order by (payload->>'value')::numeric) as p95
from public.metrics_events
where event_type = 'vitals'
  and (payload->>'value') ~ '^-?[0-9]+(\.[0-9]+)?$'
group by 1, 2, 3;

-- Most expensive single view: heap/DOM at last hide before subsequent eviction.
-- For each session, find the last 'snapshot' before the latest 'pageview'
-- whose likelyEvicted flag is true, and surface those pre-eviction values.
create or replace view public.metrics_heap_dom_at_hide as
with evicted_views as (
  select session_id, created_at as evicted_at
  from public.metrics_events
  where event_type = 'pageview'
    and metrics_jb_bool(payload, 'likelyEvicted')
), pre_snap as (
  select
    e.session_id,
    e.evicted_at,
    s.payload as snapshot,
    row_number() over (
      partition by e.session_id, e.evicted_at
      order by s.created_at desc
    ) as rn
  from evicted_views e
  join public.metrics_events s
    on s.session_id = e.session_id
   and s.event_type = 'snapshot'
   and s.created_at < e.evicted_at
)
select
  session_id,
  evicted_at,
  metrics_jb_num(snapshot, 'usedJSHeapSize')::bigint as used_js_heap_size,
  metrics_jb_num(snapshot, 'domNodes')::int as dom_nodes,
  metrics_jb_num(snapshot, 'storageUsage')::bigint as storage_usage,
  metrics_jb_num(snapshot, 'deviceMemory') as device_memory_gb
from pre_snap
where rn = 1;

-- Long-task hotspots by route pattern (PII stripped).
create or replace view public.metrics_longtasks_by_route as
select
  url_path,
  count(*) as samples,
  sum((payload->>'duration')::numeric) as total_ms,
  avg((payload->>'duration')::numeric) as avg_ms,
  max((payload->>'duration')::numeric) as max_ms
from public.metrics_events
where event_type = 'longtask'
  and (payload->>'duration') ~ '^-?[0-9]+(\.[0-9]+)?$'
group by 1;

-- Single function the Edge Function calls. Returns one JSONB blob with all
-- sections. security definer + revoke/grant means only service_role reaches it.
create or replace function public.metrics_summary(p_period interval default '7 days')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_cur_start timestamptz := v_now - p_period;
  v_prev_start timestamptz := v_now - (p_period * 2);
  v_volume jsonb;
  v_volume_prev jsonb;
  v_vitals jsonb;
  v_heap_dom jsonb;
  v_longtasks jsonb;
begin
  -- Volume + eviction rate, current period, with per-UA breakdown.
  with cur as (
    select metrics_ua_family(user_agent) as ua_family, payload, session_id
    from metrics_events
    where event_type = 'pageview' and created_at >= v_cur_start
  ), by_ua as (
    select ua_family, jsonb_build_object(
      'pageviews', count(*),
      'evictions', count(*) filter (where metrics_jb_bool(payload, 'likelyEvicted')),
      'eviction_rate', round(
        (count(*) filter (where metrics_jb_bool(payload, 'likelyEvicted')))::numeric
        / nullif(count(*), 0) * 100, 2
      )
    ) as family_counts
    from cur group by ua_family
  ), totals as (
    select
      count(*) as pageviews,
      count(*) filter (where metrics_jb_bool(payload, 'likelyEvicted')) as evictions,
      count(*) filter (where metrics_jb_bool(payload, 'bfcacheRestored')) as bfcache_restores,
      count(distinct session_id) as sessions
    from cur
  )
  select jsonb_build_object(
    'pageviews', t.pageviews,
    'evictions', t.evictions,
    'bfcache_restores', t.bfcache_restores,
    'sessions', t.sessions,
    'by_ua', coalesce((select jsonb_object_agg(ua_family, family_counts) from by_ua), '{}'::jsonb)
  ) into v_volume from totals t;

  select jsonb_build_object(
    'pageviews', count(*),
    'evictions', count(*) filter (where metrics_jb_bool(payload, 'likelyEvicted'))
  ) into v_volume_prev
  from metrics_events
  where event_type = 'pageview'
    and created_at >= v_prev_start and created_at < v_cur_start;

  -- Web Vitals p75/p95 by metric and UA family.
  select coalesce(jsonb_agg(row_to_json(v)), '[]'::jsonb) into v_vitals
  from (
    select
      metrics_ua_family(user_agent) as ua_family,
      payload->>'name' as metric,
      count(*) as samples,
      round(percentile_cont(0.75) within group (
        order by (payload->>'value')::numeric)::numeric, 2) as p75,
      round(percentile_cont(0.95) within group (
        order by (payload->>'value')::numeric)::numeric, 2) as p95
    from metrics_events
    where event_type = 'vitals'
      and created_at >= v_cur_start
      and (payload->>'value') ~ '^-?[0-9]+(\.[0-9]+)?$'
    group by 1, 2
    order by 2, 1
  ) v;

  -- Heap/DOM distribution at hide-time (bucketed). The view itself is the
  -- correlation; here we surface percentiles of the values that preceded
  -- evictions, for quick visual scan.
  select coalesce(jsonb_build_object(
    'samples', count(*),
    'heap_p50_mb', round(percentile_cont(0.5)
      within group (order by used_js_heap_size)::numeric / 1048576, 1),
    'heap_p95_mb', round(percentile_cont(0.95)
      within group (order by used_js_heap_size)::numeric / 1048576, 1),
    'dom_p50', percentile_cont(0.5) within group (order by dom_nodes)::int,
    'dom_p95', percentile_cont(0.95) within group (order by dom_nodes)::int,
    'storage_p95_mb', round(percentile_cont(0.95)
      within group (order by storage_usage)::numeric / 1048576, 1)
  ), '{}'::jsonb) into v_heap_dom
  from metrics_heap_dom_at_hide
  where evicted_at >= v_cur_start;

  -- Long-task hotspots, top 10 by total time.
  select coalesce(jsonb_agg(row_to_json(l)), '[]'::jsonb) into v_longtasks
  from (
    select url_path, samples, round(total_ms::numeric, 0) as total_ms,
           round(avg_ms::numeric, 1) as avg_ms,
           round(max_ms::numeric, 0) as max_ms
    from (
      select url_path, count(*) as samples,
             sum((payload->>'duration')::numeric) as total_ms,
             avg((payload->>'duration')::numeric) as avg_ms,
             max((payload->>'duration')::numeric) as max_ms
      from metrics_events
      where event_type = 'longtask'
        and created_at >= v_cur_start
        and (payload->>'duration') ~ '^-?[0-9]+(\.[0-9]+)?$'
      group by url_path
    ) raw
    order by total_ms desc nulls last
    limit 10
  ) l;

  return jsonb_build_object(
    'period', extract(epoch from p_period)::int,
    'generated_at', v_now,
    'volume', coalesce(v_volume, '{}'::jsonb),
    'volume_prev', coalesce(v_volume_prev, '{}'::jsonb),
    'vitals', v_vitals,
    'heap_dom_at_hide', v_heap_dom,
    'longtasks_top', v_longtasks
  );
end;
$$;

revoke all on function public.metrics_summary(interval) from public, anon, authenticated;
grant execute on function public.metrics_summary(interval) to service_role;
