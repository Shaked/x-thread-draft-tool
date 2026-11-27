# Agents share one tested way to branch, open and check pull requests

- The branch, pull request and check-reading steps for agents now live in a plugin that other projects can install.
- This repository keeps its own short rules and its deployed smoke check on top of it.

Area: Docs
Link: https://github.com/Shaked/x-thread-draft-tool/pull/565

## Technical details

`plugins/pr-workflow` at 0.1.0 (skill, `scripts/agent-pr.sh` with `repo`, `branch`, `push`, `pr`, `checks`), `scripts/agent-pr.sh` as a wrapper that keeps `smoke`, `.claude/skills/agent-pr-workflow.md`, the marketplace entry, the client matrix rows and `tests/unit/plugin-pr-workflow.test.js` (no network).
