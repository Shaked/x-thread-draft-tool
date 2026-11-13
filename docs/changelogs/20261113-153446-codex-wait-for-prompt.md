# MCP: Codex login waits for the callback prompt
- tests/clients/codex-login.mjs waits for Codex's "Callback URL" prompt before it writes the approved redirect. Earlier input can be flushed when the hidden prompt starts, which made the CI clients job time out.
