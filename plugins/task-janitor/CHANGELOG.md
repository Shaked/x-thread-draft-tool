# Changelog

## 0.1.1

- The words of an issue title in a report lose `@`, markup characters and URLs, and are cut at 24 characters, so a title
  written by an outsider cannot ping a user or inject markup when the report is posted.
- When the reply-style lint is set, a title description it rejects (Hebrew, an emoji, a filler word) becomes "title held back by lint", so one title cannot stop a posted report.
- `fetch` leaves the report issue out of the `RELEASE` and `CLAIM` marker lists.

## 0.1.0

- First release as a plugin. The janitor, the session matcher, the status board, their skill, the `janitor-summary` and
  `status-board` templates and the `/janitor` and `/status` commands moved here from the repository's own folders.
- Settings come from `.claude/agent-kit.json` (`repo`, `owner`, and the `task-janitor` section: `replyLint`,
  `manualTestsIssue`, `reportIssue`, `dispatcherIssue`). Without them the report says "Reply style: not checked" and
  the optional issues are left out.
- The scripts run from the plugin folder; the repository keeps thin wrappers in `scripts/` that call the same `main()`.
