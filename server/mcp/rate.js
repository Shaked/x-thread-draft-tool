// Tool-call rate limit for the MCP server (plan M8): at most 120 tools/call per user per minute.
// One upsert per call; the count is per minute (date_trunc), so the window resets on its own.
import { query } from '../db.js'

export const TOOL_CALLS_PER_MINUTE = 120
export const RATE_LIMIT_MESSAGE = 'Rate limit reached: at most 120 tool calls per minute. Wait one minute.'

/** Counts one tool call for the user. Returns true when the call is within the limit. */
export async function withinToolRate(userId) {
  const { rows } = await query(
    `insert into mcp_rate_limits (user_id, minute, calls)
     values ($1, date_trunc('minute', now()), 1)
     on conflict (user_id, minute) do update set calls = mcp_rate_limits.calls + 1
     returning calls`,
    [userId]
  )
  return rows[0].calls <= TOOL_CALLS_PER_MINUTE
}
