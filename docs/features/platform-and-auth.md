# Platform and Auth

- PWA support.
- Mobile-responsive UI.
- GitHub OAuth sign-in (`/api/auth/login`, `/api/auth/callback`). Anyone with a GitHub account can sign in.
- Session: signed HS256 cookie `xt_session` (HttpOnly, Secure, SameSite=Lax, 30 days). The GitHub token is not stored.
- Owner-only writes are filtered by the session user id in every query; a non-owner gets 404.
- Deployment metadata visibility.
- API tokens page (`/settings/tokens`): create and revoke tokens.
- Feature flags page (`/settings/flags`, in the menu): two per-device switches (#406, approved by Shaked 2026-11-25; real components asked for 2026-11-26). Look: the current purple look or the Rare UI look; it sets `data-skin` on `<html>` from `xt-skin` in localStorage, and `src/styles/tokens.css` overrides tokens only, so every page and `src/ui/` component follows; colour contrast is tested for both looks. Components: the real Rare UI components, copied into `src/ui/rare/` under their licence (MIT with Commons Clause and an attribution clause, `THIRD_PARTY_LICENSES/rare-ui.md`), replace the theme choice in the menu, Delete draft in the list and the post character counter (`xt-kit` in localStorage, read by `src/ui/ThemePicker.jsx`, `src/ui/DeleteButton.jsx` and `src/ui/Count.jsx`). They use Tailwind utilities that take only token values, so they follow the look and the theme. The page links to https://rareui.com as the required credit.
- Connected apps page (`/settings/apps`): "Connect an AI app" lists the four clients with copy buttons; "Connected apps" lists and revokes them.
- Suspension: a suspended account is refused on every sign-in path (cookie, `xt_` and `xta_` tokens, MCP, the OAuth token endpoint, device sign-in, the GitHub callback, the CI identity). The API answers 403 "This account is suspended."; the app shows that notice above the sign-in button (`/?suspended=1`); share links of the account's drafts answer 410 and are not used up. Nothing is deleted, and everything works again after the suspension is lifted.
- MCP connector at `/api/mcp` (OAuth 2.1 with PKCE, rotating refresh tokens). Setup and tools: [docs/agents/mcp.md](../agents/mcp.md).

The MCP connector also offers four slash commands (prompts): `thread_from_notes`, `tighten_draft`, `review_before_publish` and `rewrite_hook`. It serves one skill, `x-thread-drafts` (at `skill://x-thread-drafts/SKILL.md`). Some tools also show a small view inside Claude or ChatGPT: the thread, the drafts list and the share card ([views](../agents/mcp.md#views-in-claude-and-chatgpt)). Requests may be in Hebrew (עברית), using words such as טיוטה (draft), שרשור (thread) and ציוץ (tweet). X and Twitter (X/טוויטר) are the same service. Publishing a draft in this app posts nothing to X/Twitter.
