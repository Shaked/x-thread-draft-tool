# PKCE checks before reuse revocation (PR #50)

- `POST /api/oauth/token` now checks the client, redirect URI and PKCE verifier before it applies reuse revocation. A redeemed code presented with a wrong verifier or redirect URI gets `invalid_grant` and changes nothing: the grant and its tokens stay active.
- A redeemed code presented with the correct client, redirect URI, verifier and resource still revokes the grant (a genuine replay by the legitimate client).
- Tests: `tests/api/oauth.test.js` adds two regression tests (wrong verifier, wrong redirect URI do not revoke). The existing reuse test still covers the revoke case.
