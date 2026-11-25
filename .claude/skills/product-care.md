---
name: product-care
description: What agents must care about for this product (AI app clients, MCP protocol versions, X text rules, platform and checks), with a source and a last-checked date for each fact. The weekly improvement review updates it. Read it before a weekly review, or before changing MCP, client text or platform settings.
---

# Skill: Product care (what to watch for this product)

Every fact has a source and a date. A fact with no check says `not checked`. Do not state a fact as
true unless you read its source in this run. The weekly review updates this file (rules in
`docs/operations/weekly-review.md`).

Format of a fact: **claim** (source, last checked YYYY-MM-DD or `not checked`).

## Clients

The machine copy is `tests/eval/discovery/clients.json` (task #278). Keep the two the same. The
table lists what each AI app shows or reads. `true` or `false` only with a source that was read.

| Client | Reads instructions | Shows prompts | Reads resources | Renders UI views | Reads tool title |
|---|---|---|---|---|---|
| Claude.ai | not checked | not checked | not checked | true (https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp, checked 2026-11-21) | not checked |
| Claude Desktop | not checked | not checked | not checked | not checked | not checked |
| ChatGPT | not checked | not checked | not checked | true (https://github.com/Shaked/x-thread-draft-tool/issues/357, owner record) | not checked |
| Grok | not checked | not checked | not checked | not checked | not checked |
| Claude Code | not checked (https://code.claude.com/docs/en/mcp) | not checked (https://code.claude.com/docs/en/mcp) | not checked (https://code.claude.com/docs/en/mcp) | not checked | not checked |
| Codex | not checked | not checked | not checked | not checked | not checked |
| Generic | not checked | not checked | not checked | not checked | not checked |

Languages: English and Hebrew (`languages` in `clients.json`). Slash commands for the tools and the
connector must match across every client (Shaked, 2026-11-20, #273).

## Protocols

- `SUPPORTED_VERSIONS` in `server/mcp/server.js`: the latest is `2026-07-28`, then `2025-11-25`,
  `2025-06-18`, `2025-03-26` (repo file, checked 2026-11-25).
- Pins in `package.json`: `@modelcontextprotocol/ext-apps` 1.7.5 and `@modelcontextprotocol/sdk`
  1.32.2 (repo file, checked 2026-11-25).
- Schema fixtures in `tests/api/fixtures/mcp-schema/`: `2025-11-25.schema.json` and
  `2026-07-28.schema.json` (repo, checked 2026-11-25).
- The MCP specification itself: https://modelcontextprotocol.io/specification (not checked).

## Formats

- X text: 280 characters per post, from `src/utils/threadSplitter.js`; the weights are in
  `src/utils/xLength.js` (repo files, checked 2026-11-25). The X rules themselves: not checked.
- Images: at most 4 per post, `MAX_IMAGES` in `server/mcp/tools.js` (repo, checked 2026-11-25).
- Hebrew rules: `server/mcp/language.js` (repo, checked 2026-11-25).
- Changelog entries: the app cuts the title and first three lines at 280 characters
  (`docs/operations/changelog.md`, checked 2026-11-25).

## Platform

- CI Node version: `node-version: 20` in `.github/workflows/*.yml` (repo, checked 2026-11-25).
- Vercel runtime version: not checked. Source to read: https://vercel.com/docs (not checked).
- Neon Postgres: not checked. Source to read: https://neon.com/docs (not checked).
- Vercel Blob: not checked. Source to read: https://vercel.com/docs/vercel-blob (not checked).
- Telegram Bot API: not checked. Source to read: https://core.telegram.org/bots/api (not checked).

## Checks

- Discovery evaluation, English and Hebrew: `tests/eval/discovery/` (task #278; repo, checked 2026-11-25).
- Dependency audit: `npm audit` (command; the result is checked only when the weekly run runs it).
- Smoke test after a deploy: `scripts/smoke.mjs` (repo, checked 2026-11-25).

## How to update this skill

- The weekly run edits only facts it checked in that run. Next to each changed fact it writes the
  source and today's date.
- A fact it could not check stays `not checked`. It never writes a fact from memory.
- Keep the Clients table the same as `tests/eval/discovery/clients.json`.
