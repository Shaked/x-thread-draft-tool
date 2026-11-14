# Share links expire and can be revoked (T2)

- Share links stop after a lifetime (default 1 hour; API and MCP accept 60 seconds to 7 days) and can be revoked, one or all per draft (`DELETE /api/drafts/:id/share-tokens[/:token]`, MCP `revoke_share_link`).
- Reusable links (`one_time: false`): the new Share menu (15 minutes, 1 hour, 1 day, 7 days) copies one. X Thread and Agent link buttons still make one-time links, now expiring after 1 hour.
- Migration 007 adds `share_tokens.expires_at` and `one_time`. Existing unused links now expire one hour after creation.
- Removed the dead read-only editor code and its CSS (`.view-only-notice`, `.draft-title-display`).
