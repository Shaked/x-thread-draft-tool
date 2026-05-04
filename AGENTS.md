# Agent Working Guide (canonical)

**Every agent working on this repo — Claude, Codex/GPT, Gemini, Cursor,
human-driven copilots, anything else — MUST read and follow the rules in
[`claude.md`](./claude.md) before making changes.**

This file exists because different agents look in different places for their
instructions:

- Claude / Claude Code reads `claude.md` (and `CLAUDE.md`).
- Codex / OpenAI ChatGPT agents read `AGENTS.md`.
- Other tools may scan repository root for either name.

To avoid drift, this file is intentionally a thin pointer. The single source
of truth is `claude.md`.

## Required for all agents

1. **Read `claude.md`** at the start of every task. Treat its rules as binding.
2. **Use the indexed skills** in `.claude/skills/` (mirrored in
   `.codex/skills/`). Apply the relevant skill before changing UI logic,
   routing, sharing, persistence, deploy/release, or build/test workflow.
3. **Run pre-commit checks** with `npm run precommit:checks` (lint + unit
   tests + docs refresh) before pushing. The same checks run via the
   `.githooks/pre-commit` hook, which is wired automatically by
   `npm run prepare`. Do not bypass hooks (no `--no-verify`).
4. **Update docs in the same PR/commit set** when behavior changes:
   - `docs/plans/current.md` if priorities or execution shifted.
   - The relevant file under `docs/features/` if behavior/capabilities
     changed.
   - `README.md` if user-facing setup/workflow/features changed.
   - A new timestamped changelog under `docs/changelogs/` using
     `YYYYMMDD-HHMMSS-<slug>.md` (UTC). Never reuse an existing changelog
     file.
   - Run `npm run docs:refresh` so `claude.md`'s auto-index reflects the
     latest feature/skill map.
5. **Branching**: develop on the branch the task assigns; do not push to
   `main` directly.
6. **High-risk zones** listed in `.claude/skills/high-risk-features.md`
   require small, isolated commits and regression tests where practical.

## Cross-references
- Workflow rules and feature/skill index: [`claude.md`](./claude.md)
- Skill files: [`.claude/skills/`](./.claude/skills) (mirror:
  [`.codex/skills/`](./.codex/skills))
- Feature docs: [`docs/features/`](./docs/features)
- Changelog policy: [`docs/changelogs/README.md`](./docs/changelogs/README.md)

If anything in this file appears to conflict with `claude.md`, **`claude.md`
wins** — open a PR to resolve the discrepancy rather than diverging.
