# Codex sign-in test follows the redirect

- The Codex sign-in test now opens the approval redirect the way a browser does.
- Pasting the redirect in did not finish sign-in during the clients check.
- A failure now prints the end of Codex's output.

Area: Docs
Link: https://github.com/Shaked/x-thread-draft-tool/pull/94

## Technical details

# MCP: Codex login gets the callback with an HTTP GET, not a paste
- tests/clients/codex-login.mjs requests the approved redirect as a browser would, so Codex's loopback listener completes the login. Pasting it on stdin did not complete the login in the clients job. Failures now print the full tail of Codex's output.
