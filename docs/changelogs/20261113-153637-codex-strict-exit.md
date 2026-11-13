# MCP: Codex login fails on a non-zero exit and on a missing success line
- tests/clients/codex-login.mjs runs script with -e, so Codex's exit status reaches the test. It throws instead of exiting, so the dev server and login process are always stopped. It passes only on Codex's "Successfully logged in" line.
