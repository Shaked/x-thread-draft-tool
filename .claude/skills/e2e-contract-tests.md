# Skill: End-to-end contract tests without real clients or LLMs

Use this skill when asked to test a client "end to end", to prove a client can connect, to replace a manual or owner check with an automated one, or when a test would need someone to sign in, click consent or type into an app.

## Owner rules (non-negotiable)
- Tests run in normal GitHub Actions and locally with `npm run test:unit`. No person, no client binary (Claude Code, Codex, ChatGPT, Claude web), no browser sign-in, no paid LLM call.
- The default configuration uses no LLM. A real-LLM path is opt-in only via `E2E_REAL_LLM=1`, read in one helper. CI never sets it.
- No manual checks. If a step needs a human, the test is wrong: redesign it (step 2).
- Writes under test must be atomic and idempotent, and the tests must prove both.

## Steps
1. **Write the contract down first.** List each wire exchange the real client makes: request method, path, headers, body; response status, headers, body. Take it from the spec (RFC 9728, 8414, 7591, 7636, 9207, 6749 section 5, the MCP transport) and from the client's published docs. Write "not checked" for anything you did not read.
2. **Replace every human or binary step with a mock that speaks the protocol.**
   - Sign-in and consent: a session cookie from the test helpers plus a scripted POST of the consent form.
   - The client: a scripted spec-following client (`wireClient`), or the official SDK client with its `fetch` set to the in-process `route()`.
   - Outbound fetches (client metadata documents, images): `vi.spyOn(globalThis, 'fetch')` plus the resolver stub.
   - Blob store: `vi.mock`. The model: `FakeModel` from `getModel()`.
3. **Keep the server real.** Use `route()` from `server/router.js` against PGlite (`tests/api/helpers/db.js`). Never mock a handler, a token check or SQL.
4. **The client discovers, it never assumes.** Read `WWW-Authenticate` → protected-resource metadata → `authorization_servers[0]` → authorization-server metadata, and use only the endpoints listed there. Assert what real clients depend on: issuer, S256, `none` auth, registration endpoint, metadata-document flag, `state` and `iss` on the redirect, the exact loopback port, token fields and `cache-control: no-store`, error bodies (`{error, error_description}`, JSON-RPC codes), rotation (replay of an old refresh token gives `invalid_grant` and revokes the grant, so the new access token gets 401).
5. **One profile per client.** Use a table of identity, redirect URI, `resource` sent or not, and protocol version, then `describe.each`. When a real client fails in the field, add its profile first, and only then fix the server.
6. **Fail on hidden spend.** A fetch guard fails the test on any host other than the app and the mocked URLs. A unit test asserts that `getModel()` returns `FakeModel` when `E2E_REAL_LLM` is unset, and that no workflow file mentions `E2E_REAL_LLM`.
7. **Prove atomicity and idempotency for each write.**
   - Inject a failure with `setQueryImpl`: throw on the write statement, and separately instead of `COMMIT`. Assert the row is byte-equal to before, and that a retry succeeds once.
   - Replay the same request: same status and body, one write (version or `updated_at` changes once).
   - Concurrency: run two writes with `Promise.all`; neither is lost.
   - Conflict: a stale precondition gets 412 and no write.
8. **Opt-in real LLM (never in CI).** `describe.skipIf(process.env.E2E_REAL_LLM !== '1')`. It needs a provider key and a model id from env (no default), and it asserts the final database state, not the model's text.
9. **Run.** `npm run test:unit` locally and in CI. A new file under `tests/api/` starts with `// @vitest-environment node`. Never skip, disable or weaken an existing assertion. A deliberate behaviour change edits only that assertion and is named in the PR body.
10. **Report.** List each contract item as passed, failing (with the gap at file:line) or not checked (with what would check it). Never write "verified with a real client".
