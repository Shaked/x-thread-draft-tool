# Task janitor (this repository)

The janitor is the `task-janitor` plugin (`plugins/task-janitor`, version in its `plugin.json`). This repository uses it in place.

- Skill: `.claude/skills/task-janitor` (a link into the plugin). Commands: `.claude/commands/janitor.md` (`/janitor`) and
  `.claude/commands/status.md` (`/status`), links into the plugin.
- Scripts: `scripts/janitor.mjs`, `scripts/session-janitor.mjs`, `scripts/status-board.mjs` are wrappers. They run the plugin's
  `main()`. Edit the plugin, not the wrappers.
- Settings: `.claude/agent-kit.json`, section `task-janitor`: `manualTestsIssue` (the manual tests issue), `reportIssue` (the
  Janitor reports issue, where `/janitor` posts), `dispatcherIssue` (the dispatcher queue issue), `replyLint` (the reply-style lint).
  The keys and their defaults are in `plugins/task-janitor/README.md`.
- Tests: `tests/unit/janitor.test.js`, `session-janitor.test.js`, `status-board.test.js` and `task-janitor-plugin.test.js`.

## When to run it

Built (#461, J2, decided by Shaked 2026-11-27: "Janitor - do it"). The workflow `.github/workflows/janitor-weekly.yml` runs
every Monday at 06:17 UTC and by hand. It runs pass 1 only (`janitor.mjs fetch`, then `report`: GitHub search, no model), lints the
text with the reply-style lint and posts it as one comment on the reports issue (#497).

- It changes nothing else: no close, label, edit or delete, and no limit. Its permissions are `contents: read` and `issues: write`.
- The allowed safe fixes need a reader of each HANDOFF, so they stay in `/janitor`. The workflow has no setting for them.
- Pass 2 (Claude sessions) needs the session tools, so it stays in `/janitor` too. CI does not load comments: the report names
  the issues whose comments need reading.
- Turn it off: set the repository variable `JANITOR_AUTO` to `off` (also `false` or `0`, any case), or disable the workflow in the Actions tab.
- It posts the pass 1 report inside the `status-report` template (the report under `Details`), not the `/janitor` summary (the reports issue says so in one line).
- Issue titles are written by anyone: the report keeps no `@`, markup or URL from a title (`safeWord` in `janitor.mjs`).
- Not proven until it ran: start the first run by hand (Actions tab, `dry_run` on first), then read the Monday run.
- Test: `tests/unit/janitor-weekly-workflow.test.js`.

Earlier design (2026-11-25, #458): a run after about 10 new issues, started by the dispatcher counting new issues. It is not built;
the weekly run replaces it. A `janitor.mjs due` count can still be added if a faster trigger is wanted.
