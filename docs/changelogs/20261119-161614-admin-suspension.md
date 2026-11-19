# Suspension on every sign-in path (A6, #194)

- A suspended account is refused with 403 "This account is suspended." on the cookie, `xt_` and `xta_` tokens, MCP, the OAuth token endpoint, device sign-in and the GitHub callback. The sign-in page shows the notice. Share links of its drafts answer 410. No tool suspends anyone yet (A8).
- The check is part of the statements each path already runs: no extra database round trip.
- Tests: tests/api/suspension.test.js, query-budget.test.js (suspended requests cost the same or less).
