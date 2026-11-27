# Codex sign-in test fails on errors

- The Codex sign-in test now fails when Codex exits with an error.
- It passes only when Codex prints "Successfully logged in".
- The dev server and login process are always stopped, even on failure.

Area: Docs
Link: https://github.com/Shaked/x-thread-draft-tool/pull/94

## Technical details

# MCP: Codex login fails on a non-zero exit and on a missing success line
- tests/clients/codex-login.mjs runs script with -e, so Codex's exit status reaches the test. It throws instead of exiting, so the dev server and login process are always stopped. It passes only on Codex's "Successfully logged in" line.
