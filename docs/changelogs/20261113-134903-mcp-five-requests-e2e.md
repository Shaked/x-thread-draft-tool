# MCP: the five check-list requests as an automated end-to-end test
- tests/api/mcp-five-requests.test.js runs the M11 requests through POST /api/mcp with a real OAuth token, including the one-time share link and a refresh before the last list. It proves the server side without a person; real-client runs stay owner actions.
