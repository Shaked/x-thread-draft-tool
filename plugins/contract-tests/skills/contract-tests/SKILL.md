---
name: contract-tests
description: End-to-end contract tests without real clients, people or model calls. Keep the server real, replace each human or binary step with a mock that speaks the protocol, discover endpoints, one profile per client, and prove atomic and idempotent writes.
---

# Skill: End-to-end contract tests without real clients or model calls

Use this skill when asked to test a client "end to end", to prove a client can connect, to replace a manual check with an automated one, or when a test would need someone to sign in, click consent or type into an app.

## Rules
- Tests run in ordinary continuous integration and on a developer's machine with the project's unit test command. No person, no client binary, no browser sign-in, no paid model call.
- No manual checks. If a step needs a human, the test is wrong: redesign it (step 2).
- Writes under test must be atomic and idempotent, and the tests must prove both.

## Steps
1. **Write the contract down first.** List each wire exchange the real client makes: request method, path, headers and body; response status, headers and body. Take it from the specification the protocol names and from the client's published documentation. Write "not checked" for anything you did not read.
2. **Replace every human or binary step with a mock that speaks the protocol.**
   - Sign-in and consent: a session cookie from the test helpers, plus a scripted POST of the consent form.
   - The client: a scripted client that follows the specification, or the official SDK client with its `fetch` pointed at the in-process router.
   - Outbound fetches (client metadata documents, images): spy on the global `fetch` and stub the resolver.
   - Blob or object storage: mock the module.
3. **Keep the server real.** Call the router in-process against an in-memory or embedded database. Never mock a request handler, a token check or a query.
4. **The client discovers, it never assumes.** Follow the discovery chain the protocol defines (for example: the challenge header, then the resource metadata, then the authorization server metadata), and use only the endpoints that the documents list. Assert what real clients depend on: the issuer; the code challenge method (the S256 method only, if the protocol offers others); the authentication method the client uses (`none` for a public client); the registration endpoint; whether the client identifies itself by a metadata document rather than registering; `state` and `iss` on the redirect; the exact loopback port; token fields and `cache-control: no-store`; the error body shape the protocol defines, plus the error codes of the transport; and token rotation (replaying an old refresh token gets the protocol's invalid-grant error and revokes the grant, so the new access token is refused with the transport's unauthorized status).
5. **One profile per client.** Use a table of identity, redirect URI, whether the resource parameter is sent, and protocol version, then `describe.each` over it. When a real client fails in the field, add its profile first, and only then fix the server.
6. **Fail on hidden spend.** A fetch guard fails the test on any host other than the server under test and the mocked URLs.
7. **Prove atomicity and idempotency for each write.**
   - Inject a failure into the database: throw on the write statement, and separately instead of the commit. Assert the stored row is byte-equal to before, and that one retry succeeds.
   - Replay the same request: same status and body, and one write (a version or an update time changes once).
   - Concurrency: run two writes with `Promise.all`; neither is lost.
   - Conflict: a stale precondition gets 412 (or the protocol's equivalent) and no write.
8. **Run.** Put the tests where the project's unit test command finds them. A new test file starts with the environment comment the test runner needs. Never skip, disable or weaken an existing assertion. A deliberate behaviour change edits only that assertion and is named in the pull request body.
9. **Report.** List each contract item as passed, failing (with the gap at file and line) or not checked (with what would check it). Never write "verified with a real client".
