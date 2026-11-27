# Claude Code and Codex can now sign in

- Sign-in accepts a return address on any local port.
- Sign-in no longer needs the extra resource setting that Codex leaves out.

Area: AI apps
Link: https://github.com/Shaked/x-thread-draft-tool/pull/81

## Technical details

- MCP M1: OAuth accepts a loopback redirect URI with any port (RFC 8252), and the token endpoint takes `resource` as optional.
- Why: Claude Code listens on a random loopback port and Codex omits `resource`; both were refused before. Plan: docs/plans/mcp-clients.md (step M1).
