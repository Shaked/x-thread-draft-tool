// Tool-call rate limit for the MCP server (plan M8): at most 120 tools/call per user per minute.
// One upsert per call; the count is per minute (date_trunc), so the window resets on its own.
// Plan P4: the token check and the count are one statement (`authorizeAndCount`).
import { query } from '../db.js'
import { hashToken } from '../tokens.js'

const TOOL_CALLS_PER_MINUTE = 120
export const RATE_LIMIT_MESSAGE = 'Rate limit reached: at most 120 tool calls per minute. Wait one minute.'

// The same checks as resolveAccess (server/oauth/tokens.js).
const TOKEN_OWNER = `
  select g.id as grant_id, u.id as uid, u.github_id, u.login
    from oauth_tokens t join oauth_grants g on g.id = t.grant_id join users u on u.id = g.user_id
   where t.token_hash = $1 and t.kind = 'access' and t.expires_at > now()
     and g.revoked_at is null and g.resource = $2`

// Requests that do not count (initialize, tools/list, prompts and resources) run only the token check.
const AUTHORIZE = TOKEN_OWNER

// A counted tools/call: the same check and the count in one statement. `calls` is the new count.
const AUTHORIZE_AND_COUNT = `
  with a as (${TOKEN_OWNER}), r as (
    insert into mcp_rate_limits (user_id, minute, calls)
    select uid, date_trunc('minute', now()), 1 from a
    on conflict (user_id, minute) do update set calls = mcp_rate_limits.calls + 1
    returning calls
  )
  select a.*, (select calls from r) as calls from a`

/**
 * Checks the OAuth access token for `resource` and, when `count` is true, counts one tools/call.
 * Returns null when the token is not valid, else the caller with `withinRate` (true when the call
 * was not counted or is within the limit).
 */
export async function authorizeAndCount(token, resource, count) {
  const { rows } = await query(count ? AUTHORIZE_AND_COUNT : AUTHORIZE, [hashToken(token), resource])
  const row = rows[0]
  if (!row) return null
  return {
    uid: row.uid,
    gh: String(row.github_id),
    login: row.login,
    via: 'oauth',
    grantId: row.grant_id,
    withinRate: (row.calls ?? 0) <= TOOL_CALLS_PER_MINUTE
  }
}
