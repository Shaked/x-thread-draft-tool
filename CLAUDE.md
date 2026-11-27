# Claude + Codex Working Guide

Read [`AGENTS.md`](./AGENTS.md) first: it holds the rules for every session in this repo, starting with
"Replies to Shaked" at its top ([`reply-style` skill](./.claude/skills/reply-style/SKILL.md)).

This file is the primary, actionable map for what to use.

<!-- AUTO-INDEX:START -->
_Last refreshed: 2026-11-27 01:03:11.663 UTC_

## Feature Index (auto-generated, use directly)
- Draft Management: [`docs/features/draft-management.md`](./docs/features/draft-management.md)
- Media Attachments: [`docs/features/media-attachments.md`](./docs/features/media-attachments.md)
- Platform and Auth: [`docs/features/platform-and-auth.md`](./docs/features/platform-and-auth.md)
- Sharing and Export: [`docs/features/sharing-and-export.md`](./docs/features/sharing-and-export.md)
- Sync and Offline: [`docs/features/sync-and-offline.md`](./docs/features/sync-and-offline.md)
- Thread Composition: [`docs/features/thread-composition.md`](./docs/features/thread-composition.md)

## Auto Skill Map (use directly)
- Skill: Agent Branch, PR and CI Workflow: [`.claude/skills/agent-pr-workflow.md`](./.claude/skills/agent-pr-workflow.md)
- Skill: Build and Test Workflow: [`.claude/skills/build-and-test.md`](./.claude/skills/build-and-test.md)
- Skill: Deploy and Release Safety: [`.claude/skills/deploy-and-release.md`](./.claude/skills/deploy-and-release.md)
- Skill: End-to-end contract tests without real clients or LLMs: [`.claude/skills/e2e-contract-tests.md`](./.claude/skills/e2e-contract-tests.md)
- Skill: High-Risk Feature Concentration: [`.claude/skills/high-risk-features.md`](./.claude/skills/high-risk-features.md)
- Skill: JS/TS Quality and Type Safety Direction: [`.claude/skills/js-ts-quality.md`](./.claude/skills/js-ts-quality.md)
- Skill: Emit metrics: [`.claude/skills/metrics-emit/SKILL.md`](./.claude/skills/metrics-emit/SKILL.md)
- Skill: Read and act on metrics: [`.claude/skills/metrics-read-act/SKILL.md`](./.claude/skills/metrics-read-act/SKILL.md)
- Skill: Product care (what to watch for this product): [`.claude/skills/product-care.md`](./.claude/skills/product-care.md)
- pstack-bro: [`.claude/skills/pstack-bro/SKILL.md`](./.claude/skills/pstack-bro/SKILL.md)
- Technical writing: [`.claude/skills/pstack-technical-writing/SKILL.md`](./.claude/skills/pstack-technical-writing/SKILL.md)
- Unslop: [`.claude/skills/pstack-unslop/SKILL.md`](./.claude/skills/pstack-unslop/SKILL.md)
- Skill: Reply style (templates for replies to the owner): [`.claude/skills/reply-style/SKILL.md`](./.claude/skills/reply-style/SKILL.md)
- Skill: Task janitor: [`.claude/skills/task-janitor/SKILL.md`](./.claude/skills/task-janitor/SKILL.md)
- Skill: UI debug (screenshots, errors and layout with the right tools): [`.claude/skills/ui-debug/SKILL.md`](./.claude/skills/ui-debug/SKILL.md)
- Skill: UI design with the design system: [`.claude/skills/ui-design.md`](./.claude/skills/ui-design.md)
<!-- AUTO-INDEX:END -->

## Using the product as an agent
- The app has a JSON API (`/api`) with personal API tokens. Read [`docs/agents/api.md`](./docs/agents/api.md) (auth, endpoints, limits, how to test). Discovery: `/llms.txt`, `/api/openapi.json`.
- Run `npm run test:unit` (includes API tests) and `npm run smoke` against `npm run dev:api` before pushing API changes. Never ask a human to run them.

## Changelog conflict-avoidance policy
- Every task/PR must add a new file under `docs/changelogs/`.
- Use UTC timestamp+slug filenames: `YYYYMMDD-HHMMSS-<slug>.md`.
- Do not reuse or append to someone else’s in-flight changelog file.
- See details in [`docs/changelogs/README.md`](./docs/changelogs/README.md).

## Required docs updates for every task
For each meaningful code change, update docs in the same PR/commit set:
1. Plan status (`docs/plans/current.md`) if priorities or execution changed.
2. Feature files in `docs/features/` (indexed above) if behavior/capabilities changed.
3. README (`README.md`) when user-facing setup/workflow/features changed.
4. Add one new changelog file in `docs/changelogs/` using the naming policy.
5. Run `npm run docs:refresh` so this file reflects the latest feature/skill map and timestamp.

## Workflow rules
- Run pre-commit checks (`npm run precommit:checks`) before pushing.
- Branches, commits, PRs and CI reading: follow [`.claude/skills/agent-pr-workflow.md`](./.claude/skills/agent-pr-workflow.md) and use `scripts/agent-pr.sh`.
- Keep E2E as a GitHub Actions gate unless debugging a specific E2E failure.
