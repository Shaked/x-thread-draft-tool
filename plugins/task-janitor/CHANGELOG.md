# Changelog

## 0.1.2

- A title word is cut at 24 code points, not 24 UTF-16 units, so an astral letter is never split.

## 0.1.1

- The words of an issue title in a report go through an allowlist (NFKC, then letters, digits, spaces and hyphens only),
  so a title written by an outsider cannot ping a user, link, or inject markup when the report is posted. Punctuation in
  a description is gone (a comma or colon).
- When the reply-style lint is set, a title description it rejects (Hebrew, an emoji, a filler word) becomes "title held back by lint", so one title cannot stop a posted report.
- `fetch` leaves the report issue out of the `RELEASE` and `CLAIM` marker lists.

## 0.1.0

- First release as a plugin. The janitor, the session matcher, the status board, their skill, the `janitor-summary` and
  `status-board` templates and the `/janitor` and `/status` commands moved here from the repository's own folders.
- Settings come from `.claude/agent-kit.json` (`repo`, `owner`, and the `task-janitor` section: `replyLint`,
  `manualTestsIssue`, `reportIssue`, `dispatcherIssue`). Without them the report says "Reply style: not checked" and
  the optional issues are left out.
- The scripts run from the plugin folder; the repository keeps thin wrappers in `scripts/` that call the same `main()`.
