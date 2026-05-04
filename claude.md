# Claude + Codex Working Guide

This file is the primary, actionable map for what to use.

<!-- AUTO-INDEX:START -->
_Last refreshed: 2026-05-04 08:42:11.824 UTC_

## Feature Index (auto-generated, use directly)
- Draft Management: [`docs/features/draft-management.md`](./docs/features/draft-management.md)
- Media Attachments: [`docs/features/media-attachments.md`](./docs/features/media-attachments.md)
- Platform and Auth: [`docs/features/platform-and-auth.md`](./docs/features/platform-and-auth.md)
- Sharing and Export: [`docs/features/sharing-and-export.md`](./docs/features/sharing-and-export.md)
- Sync and Offline: [`docs/features/sync-and-offline.md`](./docs/features/sync-and-offline.md)
- Thread Composition: [`docs/features/thread-composition.md`](./docs/features/thread-composition.md)

## Auto Skill Map (use directly)
- Skill: Build and Test Workflow: [`.claude/skills/build-and-test.md`](./.claude/skills/build-and-test.md)
- Skill: Deploy and Release Safety: [`.claude/skills/deploy-and-release.md`](./.claude/skills/deploy-and-release.md)
- Skill: High-Risk Feature Concentration: [`.claude/skills/high-risk-features.md`](./.claude/skills/high-risk-features.md)
- Skill: JS/TS Quality and Type Safety Direction: [`.claude/skills/js-ts-quality.md`](./.claude/skills/js-ts-quality.md)
<!-- AUTO-INDEX:END -->

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
- Keep E2E as a GitHub Actions gate unless debugging a specific E2E failure.
