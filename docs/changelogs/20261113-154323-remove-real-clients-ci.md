# MCP: remove the real Codex login script and the clients workflow
- Real clients are not run in CI. tests/api/mcp-clients.test.js covers the client paths with mocks and no tokens. Removes tests/clients/codex-login.mjs and .github/workflows/mcp-clients.yml (which installed the real Claude Code and Codex binaries).
