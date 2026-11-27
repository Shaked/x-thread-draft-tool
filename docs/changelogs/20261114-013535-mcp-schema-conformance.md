# AI app results are checked against schemas

- A new test checks that the results of the AI app connector match the official MCP schemas, for two protocol versions.
- This change adds a test only.

Area: AI apps
Link: https://github.com/Shaked/x-thread-draft-tool/pull/105

## Technical details

Add an official-schema conformance test: today's /api/mcp results are validated against the vendored MCP 2026-07-28 and 2025-11-25 JSON Schemas (M13, tests only).
