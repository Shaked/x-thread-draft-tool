# Share links expire and can be revoked

- Share links stop working after a set time. The default is 1 hour, and you can choose 60 seconds up to 7 days.
- You can revoke one share link, or all links of a draft.
- The new Share menu copies a reusable link that lasts 15 minutes, 1 hour, 1 day or 7 days.
- Links from the X Thread and Agent link buttons are still single-use, and now expire after 1 hour.
- Existing unused links now expire 1 hour after they were made.

Area: Security
Link: https://github.com/Shaked/x-thread-draft-tool/pull/115

## Technical details

# Share links expire and can be revoked (T2)

- Share links stop after a lifetime (default 1 hour; API and MCP accept 60 seconds to 7 days) and can be revoked, one or all per draft (`DELETE /api/drafts/:id/share-tokens[/:token]`, MCP `revoke_share_link`).
- Reusable links (`one_time: false`): the new Share menu (15 minutes, 1 hour, 1 day, 7 days) copies one. X Thread and Agent link buttons still make one-time links, now expiring after 1 hour.
- Migration 007 adds `share_tokens.expires_at` and `one_time`. Existing unused links now expire one hour after creation.
- Removed the dead read-only editor code and its CSS (`.view-only-notice`, `.draft-title-display`).
