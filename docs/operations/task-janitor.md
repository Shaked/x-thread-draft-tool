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

Phase 2 (design only, not built). Shaked asked for a run after about 10 new tasks (#458, 2026-11-25). Options checked against
`AGENTS.md` and the dispatcher rules in #154 on 2026-11-25:

| Option | How it starts an agent | Cost | What can go wrong |
|---|---|---|---|
| The dispatcher counts new issues on each pass | The dispatcher is already an agent: it runs the skill itself | One search call per pass: `created:>` the time of the last janitor report | Runs only while a dispatcher session lives. #154 says it polls its child about every 10 minutes, with a 2-hour cron watchdog; the 45 minutes in #458 is not in #154 |
| A workflow on `issues: opened` adds a `janitor-due` label to a tracker issue | It starts none: the dispatcher or the weekly review must notice the label | Actions minutes for every new issue (not checked) | A new workflow with `issues: write`; a label added with `GITHUB_TOKEN` starts no other workflow, so nothing is woken |
| A run inside the weekly review (#294, #295) | The weekly review agent runs the skill | One run a week | Up to a week late: more than 20 issues were opened on 2026-11-25 alone (checked); #295 waits for #294 |

Pick: the dispatcher count, with the weekly review as a fallback once #295 ships. It needs no new workflow, token or permission,
and the count comes from GitHub search, so no counter can drift. The first build step is a `janitor.mjs due` command that prints
the number of issues opened since the last report comment, for the dispatcher to compare with 10. The held task for phase 2 is
#461 (janitor runs by itself). Where pass 2 hooks in: the same trigger runs `/janitor`, so both passes run together (#461).
