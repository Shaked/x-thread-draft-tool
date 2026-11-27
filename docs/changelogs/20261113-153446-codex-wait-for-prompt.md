# Codex sign-in test waits for its prompt

- The Codex sign-in test waits for the Callback URL prompt before it sends the redirect.
- Input sent too early could be dropped, which made the clients check time out.

Area: Docs
Link: https://github.com/Shaked/x-thread-draft-tool/pull/94

## Technical details

# MCP: Codex login waits for the callback prompt
- tests/clients/codex-login.mjs waits for Codex's "Callback URL" prompt before it writes the approved redirect. Earlier input can be flushed when the hidden prompt starts, which made the CI clients job time out.
