# The unused-code check allows one more tool

- The unused-code check now allows the script tool, which the sign-in test uses.
- This fixes a failing unit test check.

Area: Docs
Link: https://github.com/Shaked/x-thread-draft-tool/pull/93

## Technical details

# MCP: allow the `script` binary in knip
- knip.json lists `script` (util-linux) under ignoreBinaries, because tests/clients/claude-code-login.mjs runs it to get a pseudo-terminal for `claude mcp login`. Fixes the failing Unit tests (vitest) check on PR #93.
