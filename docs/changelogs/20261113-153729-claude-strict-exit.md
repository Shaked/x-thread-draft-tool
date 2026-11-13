# MCP: Claude Code login fails on a non-zero exit and on any line but the success line
- tests/clients/claude-code-login.mjs runs script with -e, so Claude Code's exit status reaches the test, and passes only on `Authenticated with "x-thread"`. It throws instead of exiting, so the dev server and login process are always stopped. Fixes the open Codex review findings on PR #93.
