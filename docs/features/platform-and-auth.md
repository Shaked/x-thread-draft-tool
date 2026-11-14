# Platform and Auth

- PWA support.
- Mobile-responsive UI.
- GitHub OAuth sign-in (`/api/auth/login`, `/api/auth/callback`). Anyone with a GitHub account can sign in.
- Session: signed HS256 cookie `xt_session` (HttpOnly, Secure, SameSite=Lax, 30 days). The GitHub token is not stored.
- Owner-only writes are filtered by the session user id in every query; a non-owner gets 404.
- Deployment metadata visibility.
- Settings page (`/settings/tokens`): "Connect an AI app" lists the four clients with copy buttons; "Connected apps" lists and revokes them.
- MCP connector at `/api/mcp` (OAuth 2.1 with PKCE, rotating refresh tokens). Setup and tools: [docs/agents/mcp.md](../agents/mcp.md).

The MCP connector also offers four slash commands (prompts): `thread_from_notes`, `tighten_draft`, `review_before_publish` and `rewrite_hook`. It serves one skill, `x-thread-drafts` (at `skill://x-thread-drafts/SKILL.md`). Requests may be in Hebrew (עברית), using words such as טיוטה (draft), שרשור (thread) and ציוץ (tweet). X and Twitter (X/טוויטר) are the same service. Publishing a draft in this app posts nothing to X/Twitter.
