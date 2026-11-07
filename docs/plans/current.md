# Current Plans

## Completed / in place
- One-time preview link rendering fixes and tokenized preview flow are in place.
- Vercel + Neon + Vercel Blob migration implemented (Phases 1–2 and the data-migration script). The data migration and cutover are manual steps; see [vercel-migration.md](./vercel-migration.md).
- Local pre-commit checks run docs refresh + lint + unit tests.
- E2E remains gated in GitHub Actions.

## Planned next
- Next: [post-migration-hardening.md](./post-migration-hardening.md), decisions complete, Tasks 0–7 written for step-by-step execution: audit fixes, CI cleanup, security gates, quality gates, test budget, Codex review gate, light theme and friendlier UI, OIDC for CI and an MCP connector for agents.
- Finish the Supabase → Neon/Blob migration: run `data-migrate.yml` (dry run, then apply), smoke-test Preview and Production, then retire Supabase after 14 days (Phase 4 of [vercel-migration.md](./vercel-migration.md)).
- Increase regression tests around publish/archive and share-link error paths.
- Continue incremental JS/TS quality improvements in high-change areas.
- Keep feature docs current as behavior evolves.
