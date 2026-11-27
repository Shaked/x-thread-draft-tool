# A test now runs five AI app requests

- A new automated test sends the five checklist requests to the server.
- It covers a one-time share link and a sign-in refresh before the last list.
- It checks the server only, with no person. Runs with real AI apps stay with the owner.

Area: Docs
Link: https://github.com/Shaked/x-thread-draft-tool/pull/92

## Technical details

# MCP: the five check-list requests as an automated end-to-end test
- tests/api/mcp-five-requests.test.js runs the M11 requests through POST /api/mcp with a real OAuth token, including the one-time share link and a refresh before the last list. It proves the server side without a person; real-client runs stay owner actions.
