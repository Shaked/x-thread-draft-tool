# OAuth access tokens cannot manage personal API tokens

- `GET /api/tokens` and `DELETE /api/tokens/:id` now use `requirePersonalUser` (`server/session.js`). It accepts a browser session or a hand-made `xt_` token and refuses everything else with `403` ("Managing API tokens needs a browser session or a personal API token, not an OAuth grant").
- Before this change a client approved only for the `drafts` scope on `/api` could list and revoke the user's unrelated personal tokens. The consent page grants draft operations only.
- `POST /api/tokens` already refused bearer tokens (`requireSessionUser`) and is unchanged. Browser sessions and `xt_` tokens behave as before.
- Tests: `tests/api/tokens.test.js` covers an `xta_` token getting 403 on list and revoke (the token is not revoked), and a browser session and an `xt_` token still listing and revoking.
- `docs/agents/api.md` documents the 403 for OAuth callers.
