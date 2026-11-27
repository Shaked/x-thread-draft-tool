# Tests no longer use real AI app logins

- Tests no longer use real AI apps or their accounts.
- Each AI app setup is checked through the real server code, with no app, account or token.
- The separate clients check script and its command were removed.

Area: Docs
Link: https://github.com/Shaked/x-thread-draft-tool/pull/93

## Technical details

# MCP: remove the real Claude Code login script
- Real clients (the Claude Code binary, Codex, and their accounts) are not used in tests. The client path is covered by tests/api/mcp-clients.test.js, which runs each client profile through the router with no binaries, no tokens and no mocked-out server logic. Removes tests/clients/claude-code-login.mjs, the test:clients script and the knip exception for script(1).
