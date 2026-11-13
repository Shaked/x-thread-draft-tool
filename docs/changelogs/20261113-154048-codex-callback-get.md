# MCP: Codex login gets the callback with an HTTP GET, not a paste
- tests/clients/codex-login.mjs requests the approved redirect as a browser would, so Codex's loopback listener completes the login. Pasting it on stdin did not complete the login in the clients job. Failures now print the full tail of Codex's output.
