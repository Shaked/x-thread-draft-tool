# Fix flaky e2e test: mcp-share-view "waits for the OK in the chat" (#350)

- The test now waits for the host call with `expect.poll` (same pattern as mcp-drafts-view). It still requires exactly one call.
- Split out of #309; the test was already flaky on main before the browser-install change.
