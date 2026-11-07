# Agent branch, PR and CI workflow skill and helper

- New skill `.claude/skills/agent-pr-workflow.md`: plan-vs-implement scope, branches in shallow clones, commits, REST pull requests, and reading CI (including the deployed smoke test's per-environment behavior).
- New helper `scripts/agent-pr.sh`: `branch`, `push` (sets upstream), `pr` (REST), `checks`, `smoke`. Never merges or runs workflows.
- `scripts/update-claude-index.mjs` keeps the timestamp when the index is unchanged, and `.githooks/pre-commit` stages `claude.md`, so commits no longer leave a timestamp-only change behind.
