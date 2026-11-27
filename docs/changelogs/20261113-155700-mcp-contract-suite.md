# A test checks the AI app sign-in flow

- A new test plays the part of an AI app through the whole sign-in and tool flow.
- Each tool's input rules are checked strictly.
- It needs no app, account, person or AI model, and refuses any other outside request.

Area: Docs
Link: https://github.com/Shaked/x-thread-draft-tool/pull/100

## Technical details

# MCP: client contract suite (M11, A1 and A4)
- tests/api/mcp-contract.test.js: a spec-following mock client walks discovery, registration or client metadata, authorize with loopback port, consent, token, MCP calls, refresh rotation and replay. Every tool input schema compiles in strict mode (ajv and ajv-formats, exact devDependencies). No binary, no account, no person, no LLM; a fetch guard blocks any other outbound request.
