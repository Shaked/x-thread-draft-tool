# MCP: allow the `script` binary in knip
- knip.json lists `script` (util-linux) under ignoreBinaries, because tests/clients/claude-code-login.mjs runs it to get a pseudo-terminal for `claude mcp login`. Fixes the failing Unit tests (vitest) check on PR #93.
