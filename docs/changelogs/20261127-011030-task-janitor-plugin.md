# Task janitor plugin (#509)

- The task janitor, the session matcher, the status board, their skill, two templates and the `/janitor` and `/status` commands move to `plugins/task-janitor/` (0.1.0); the repo keeps wrappers in `scripts/` and links the skill and commands back.
- Project settings: `task-janitor` in `.claude/agent-kit.json` (`replyLint`, `manualTestsIssue`, `reportIssue`, `dispatcherIssue`); the report and board output for this repo is unchanged (checked on a live snapshot and fixtures).
