// Admin reads (plan A7, issue #195). Account numbers and text of users, for the owner only.
// No draft text, no token hash or prefix, no client name, no image URL: the SQL never selects them.
import { query } from '../db.js'
import { cleanLogin, cleanName } from './clean.js'
import { isProtectedGithubId } from './identity.js'

// One row per user of the page, with its counts. Each count is a lateral subquery run only for the page,
// so the page costs one statement. `last_active_at` is a lower bound: reading drafts in the browser leaves no trace.
const COUNTS = `
     left join lateral (
       select count(*)::int as drafts,
              (count(*) filter (where is_published))::int as published_drafts,
              coalesce(sum(case when jsonb_typeof(posts) = 'array' then jsonb_array_length(posts) else 0 end), 0)::int as posts,
              coalesce(sum((select count(*) from jsonb_array_elements(case when jsonb_typeof(posts) = 'array' then posts else '[]'::jsonb end) e,
                                 jsonb_array_elements(case when jsonb_typeof(e->'images') = 'array' then e->'images' else '[]'::jsonb end) i)), 0)::int as images,
              max(updated_at) as last_draft_at
         from drafts where user_id = p.id) d on true
     left join lateral (
       select (count(*) filter (where revoked_at is null and (expires_at is null or expires_at > now())))::int as api_tokens_active,
              count(*)::int as api_tokens_total, max(last_used_at) as token_last_used_at
         from api_tokens where user_id = p.id) t on true
     left join lateral (
       select (count(*) filter (where revoked_at is null))::int as connected_apps,
              max(last_used_at) as app_last_used_at
         from oauth_grants where user_id = p.id) g on true
     left join lateral (
       select count(*)::int as share_links_active from share_tokens
        where created_by = p.id and coalesce(expires_at, created_at + interval '1 hour') > now()
          and (one_time = false or used = false)) s on true
     left join lateral (
       select coalesce(sum(calls) filter (where minute > now() - interval '24 hours'), 0)::int as mcp_calls_24h,
              coalesce(sum(calls), 0)::int as mcp_calls_7d, max(minute) as last_mcp_at
         from mcp_rate_limits where user_id = p.id and minute > now() - interval '7 days') r on true`

const SELECT_USERS = `
   select p.id, p.github_id, p.login, p.name, p.avatar_url, p.created_at, p.updated_at as last_sign_in_at,
          greatest(p.updated_at, d.last_draft_at, t.token_last_used_at, g.app_last_used_at, r.last_mcp_at) as last_active_at,
          p.suspended_at, p.suspended_reason, p.cursor_ts,
          d.drafts, d.published_drafts, d.posts, d.images,
          t.api_tokens_active, t.api_tokens_total, g.connected_apps, s.share_links_active,
          r.mcp_calls_24h, r.mcp_calls_7d`

/** One page of users, newest first, `limit + 1` rows (the extra one says there is a next page). */
export async function listUserPage({ limit, afterTs, afterId, q, status }) {
  const { rows } = await query(
    `with page as (
       select id, github_id, login, name, avatar_url, created_at, updated_at, suspended_at, suspended_reason,
              created_at::text as cursor_ts
         from users
        where ($1::timestamptz is null or (created_at, id) < ($1::timestamptz, $2::uuid))
          and ($3::text is null or lower(login) like lower($3) || '%')
          and ($4::text = 'all' or ($4::text = 'suspended') = (suspended_at is not null))
        order by created_at desc, id desc
        limit $5
     )
     ${SELECT_USERS}
       from page p ${COUNTS}
      order by p.created_at desc, p.id desc`,
    [afterTs ?? null, afterId ?? null, q ?? null, status, limit + 1]
  )
  return rows
}

/** One user with the same counts (no page filter), or null. */
export async function findUserRow(id) {
  const { rows } = await query(
    `with page as (
       select id, github_id, login, name, avatar_url, created_at, updated_at, suspended_at, suspended_reason,
              created_at::text as cursor_ts
         from users where id = $1
     )
     ${SELECT_USERS}
       from page p ${COUNTS}`,
    [id]
  )
  return rows[0] ?? null
}

/** A user's API tokens without the hash, the prefix or the name (plan A7). */
export async function userApiTokens(id) {
  const { rows } = await query(
    `select id, created_via, created_at, last_used_at, expires_at, revoked_at
       from api_tokens where user_id = $1 order by created_at desc, id desc`,
    [id]
  )
  return rows
}

/** A user's connected apps: no client name (decision D9), only the kind, the host of the return address and the resource. */
export async function userConnectedApps(id) {
  const { rows } = await query(
    `select g.id, c.kind, c.redirect_uris, g.resource, g.created_at, g.last_used_at, g.revoked_at,
            (g.admin_until is not null and g.admin_until > now()) as admin
       from oauth_grants g join oauth_clients c on c.client_id = g.client_id
      where g.user_id = $1 order by g.created_at desc, g.id desc`,
    [id]
  )
  return rows
}

/** Totals, active users and signups per day (UTC, 30 days, zeros included), in one statement. */
export async function statsRow() {
  const { rows } = await query(
    `select
       (select count(*)::int from users) as users,
       (select count(*)::int from users where suspended_at is not null) as users_suspended,
       (select count(*)::int from drafts) as drafts,
       (select count(*)::int from drafts where is_published) as published_drafts,
       (select coalesce(sum(case when jsonb_typeof(posts) = 'array' then jsonb_array_length(posts) else 0 end), 0)::int from drafts) as posts,
       (select coalesce(sum((select count(*) from jsonb_array_elements(case when jsonb_typeof(posts) = 'array' then posts else '[]'::jsonb end) e,
                               jsonb_array_elements(case when jsonb_typeof(e->'images') = 'array' then e->'images' else '[]'::jsonb end) i)), 0)::int from drafts) as images,
       (select count(*)::int from api_tokens where revoked_at is null and (expires_at is null or expires_at > now())) as api_tokens_active,
       (select count(*)::int from oauth_grants where revoked_at is null) as connected_apps,
       (select count(*)::int from share_tokens where coalesce(expires_at, created_at + interval '1 hour') > now()
          and (one_time = false or used = false)) as share_links_active,
       (select coalesce(sum(calls) filter (where minute > now() - interval '24 hours'), 0)::int from mcp_rate_limits
          where minute > now() - interval '7 days') as mcp_calls_24h,
       (select coalesce(sum(calls), 0)::int from mcp_rate_limits where minute > now() - interval '7 days') as mcp_calls_7d,
       (select count(*)::int from (
          select id from users where updated_at > now() - interval '24 hours'
          union select user_id from drafts where updated_at > now() - interval '24 hours'
          union select user_id from api_tokens where last_used_at > now() - interval '24 hours'
          union select user_id from oauth_grants where last_used_at > now() - interval '24 hours'
          union select user_id from mcp_rate_limits where minute > now() - interval '24 hours') a) as active_users_24h,
       (select count(*)::int from (
          select id from users where updated_at > now() - interval '7 days'
          union select user_id from drafts where updated_at > now() - interval '7 days'
          union select user_id from api_tokens where last_used_at > now() - interval '7 days'
          union select user_id from oauth_grants where last_used_at > now() - interval '7 days'
          union select user_id from mcp_rate_limits where minute > now() - interval '7 days') a) as active_users_7d,
       (select coalesce(json_agg(json_build_object('day', g.day::date::text, 'signups', coalesce(c.n, 0)) order by g.day), '[]'::json)
          from generate_series((now() at time zone 'utc')::date - 29, (now() at time zone 'utc')::date, interval '1 day') g(day)
          left join (select (created_at at time zone 'utc')::date as d, count(*)::int as n from users group by 1) c
            on c.d = g.day::date) as signups_by_day`
  )
  return rows[0]
}

/** The newest audit rows before `before` (an ISO time, or null), `limit` at most. */
export async function auditRows({ limit, before }) {
  const { rows } = await query(
    `select id, created_at, actor_login, action, outcome, target_github_id, target_login, details
       from admin_audit
      where ($1::timestamptz is null or created_at < $1::timestamptz)
      order by created_at desc, id desc
      limit $2`,
    [before ?? null, limit]
  )
  return rows
}

/** The public shape of one user row (plan A7 step 3). */
export function userView(row) {
  const lastActive = row.last_active_at ?? row.last_sign_in_at
  return {
    id: row.id,
    github_id: String(row.github_id),
    login: cleanLogin(row.login),
    name: cleanName(row.name),
    avatar_url: row.avatar_url,
    created_at: row.created_at,
    last_sign_in_at: row.last_sign_in_at,
    last_active_at: lastActive,
    suspended_at: row.suspended_at,
    suspended_reason: row.suspended_reason,
    protected: isProtectedGithubId(row.github_id),
    drafts: row.drafts,
    published_drafts: row.published_drafts,
    posts: row.posts,
    images: row.images,
    api_tokens_active: row.api_tokens_active,
    api_tokens_total: row.api_tokens_total,
    connected_apps: row.connected_apps,
    share_links_active: row.share_links_active,
    mcp_calls_24h: row.mcp_calls_24h,
    mcp_calls_7d: row.mcp_calls_7d
  }
}

// The SQL repeats the protection on purpose (plan A8 step 2): a protected user never matches, even if the check above is skipped.
export const SUSPEND_SQL = `update users set suspended_at = now(), suspended_reason = $2
   where id = $1 and suspended_at is null and github_id <> all($3::bigint[]) returning id`
export const UNSUSPEND_SQL = `update users set suspended_at = null, suspended_reason = null
   where id = $1 and suspended_at is not null and github_id <> all($2::bigint[]) returning id`
