# Current Plans

## Completed / in place
- One-time preview link rendering fixes and tokenized preview flow are in place.
- Vercel + Neon + Vercel Blob migration implemented (Phases 1–2 and the data-migration script). The data migration and cutover are manual steps; see [vercel-migration.md](./vercel-migration.md).
- Local pre-commit checks run docs refresh + lint + unit tests.
- E2E remains gated in GitHub Actions.
- [mcp-clients.md](./mcp-clients.md): the MCP connector works with Claude, Claude Code, Codex and ChatGPT. All steps M0 to M16, and M13a, are merged (M13 #105, M13a #106, M14 #107, M15 #108, M16 this PR). The four slash commands (prompts), the `x-thread-drafts` skill, and the Hebrew and X/Twitter wording are live. M11, the client contract suite, merged via #92, #98, #99, #100, #101. Client behaviour is proven by contract tests (M11); no owner action. Ledger issues #60 and #80. Setup: [agents/mcp.md](../agents/mcp.md).

## Planned next
- Done except parked items: [post-migration-hardening.md](./post-migration-hardening.md) (Tasks 0–7: audit fixes, CI gates, Codex gate, light UI, OIDC and MCP connector). Parked: 1.2, 2.4, 4, 7.9. Runbook: [hardening-finish.md](./hardening-finish.md).
- Finish the Supabase → Neon/Blob migration: run `data-migrate.yml` (dry run, then apply), smoke-test Preview and Production, then retire Supabase after 14 days (Phase 4 of [vercel-migration.md](./vercel-migration.md)).
- Increase regression tests around publish/archive and share-link error paths.
- Continue incremental JS/TS quality improvements in high-change areas.
- Keep feature docs current as behavior evolves.
