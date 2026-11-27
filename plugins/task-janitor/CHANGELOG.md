# Changelog

## 0.1.0

- First release as a plugin. The janitor, the session matcher, the status board, their skill, the `janitor-summary` and
  `status-board` templates and the `/janitor` and `/status` commands moved here from the repository's own folders.
- Settings come from `.claude/agent-kit.json` (`repo`, `owner`, and the `task-janitor` section: `replyLint`,
  `manualTestsIssue`, `reportIssue`, `dispatcherIssue`). Without them the report says "Reply style: not checked" and
  the optional issues are left out.
- The scripts run from the plugin folder; the repository keeps thin wrappers in `scripts/` that call the same `main()`.
