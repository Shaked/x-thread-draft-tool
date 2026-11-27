# Skill: End-to-end contract tests without real clients or LLMs

The method is the plugin skill `contract-tests` (`plugins/contract-tests/skills/contract-tests/SKILL.md`, plugin `contract-tests@agent-kit`). Read it for the nine steps. This file keeps what is specific to this repository: the owner rules, and where the helpers are.

Use it when asked to test a client "end to end", to prove a client can connect, to replace a manual or owner check with an automated one, or when a test would need someone to sign in, click consent or type into an app.

## Owner rules (non-negotiable)
- Tests run in normal GitHub Actions and locally with `npm run test:unit`. No person, no client binary (Claude Code, Codex, ChatGPT, Claude web), no browser sign-in, no paid LLM call.
- The app calls no LLM and has no opt-in LLM path. Do not add one without an owner decision in the ledger.
- No manual checks. If a step needs a human, the test is wrong: redesign it (plugin step 2).
- Writes under test must be atomic and idempotent, and the tests must prove both.

## This repository's helpers
- Router: `route()` from `server/router.js`, called in-process (the server stays real).
- Database: PGlite through `tests/api/helpers/db.js`. Inject a failure with `setQueryImpl` from `server/db.js`.
- Scripted client and sign-in: the `discover` and `signIn` helpers in `tests/api/mcp-contract.test.js`. Profiles are a table in the same file. The other option the plugin allows is the official SDK client with its `fetch` set to `route()`.
- What this app's clients depend on (plugin step 4, with this app's values):
  - Authorization code with PKCE using `S256` only.
  - Public client with `none` authentication; registration endpoint present.
  - Client metadata document flag set, so clients identify themselves by URL.
  - Redirect carries `state` and `iss`; loopback redirect uses the exact port the client registered.
  - Errors are `{error, error_description}`; MCP JSON-RPC errors use the JSON-RPC codes.
  - Token responses set `cache-control: no-store`.
  - Replaying an old refresh token gives `invalid_grant` and revokes the grant, so the new access token gets 401.
- Outbound fetches: `vi.spyOn(globalThis, 'fetch')` plus the resolver stub. Blob store: `vi.mock`.
- Specification references for this app: RFC 9728, 8414, 7591, 7636, 9207, 6749 section 5, and the MCP transport.
- A new file under `tests/api/` starts with `// @vitest-environment node`.
- Never skip, disable or weaken an existing assertion.
