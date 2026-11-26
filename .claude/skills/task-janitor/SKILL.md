---
name: task-janitor
description: Find duplicate, shipped-but-open, stale, mis-ordered and mislabelled issues with a read-only script, then apply only the safe fixes. Use it when asked to clean the task list, before planning new tasks, or when an epic nears 100 sub-issues.
---

# Skill: Task janitor

The janitor reads the issue list and prints one line per problem with a proposed fix.
The script `scripts/janitor.mjs` is deterministic, has no model inside and never writes to GitHub.
You read the report and apply the fixes this skill allows. Task: #458 (task janitor skill, phase 1).

## Run it
1. Snapshot (gh search only, as AGENTS.md allows):
   `node scripts/janitor.mjs fetch > snapshot.json`
   It holds open and closed issues, merged and open pull requests, and two lists of open issues with a comment that contains
   `RELEASE` or `CLAIM`. It has no comment bodies.
2. Comments: the first report names issues whose comments are not loaded. Read those with
   `mcp__github__issue_read` (`get_comments`, `perPage` 100, and the next page while a page is full) and save them as
   `comments.json`: an object from issue number to `[{ "user", "author_association", "created_at", "body" }]`.
   Load the held and owner issues too, if they have comments.
3. Report:
   `node scripts/janitor.mjs report snapshot.json --comments comments.json [--today YYYY-MM-DD] [--stale-days 14]`
4. Keep both files in your scratchpad. Never commit them: they hold issue text.

## What it checks
| Section | Finding |
|---|---|
| Shipped but open | The last HANDOFF ends with ` - done` and has `RELEASE`; or a merged PR says `Closes`, `Fixes`, `Resolves` or `Implements #n`. Only HANDOFFs by the owner, a member or a collaborator count |
| Duplicates and overlap | Same title; near-same title; same task id in one epic; a rare file, route or table named by tasks of two epics |
| Dependencies | A `Depends on` number that is a PR, missing, or closed as not planned; a task id named without its number; a clause that starts with `Goes before #n` or `Before #n` and has no matching line on `#n`; a claimed task with an open dependency; cycles |
| Stale and orphaned | No activity for 14 days; a task with no parent; a CLAIM heartbeat older than 3 hours with no RELEASE; `held` or `owner` with no owner question |
| Limits | An epic with 90 or more of its 100 sub-issues |
| Labels | No label; sub-issues and no `epic` label; the body says `held` but the label is gone |

The report ends with a valid order of the open tasks (dependencies first), in a code block.
A finding is a lead, not a verdict. Read the issue before you act on it.

## Act on the report
Each fix ends with who acts. `allowed`: you may apply it. `dispatcher`: the dispatcher decides, you only report.
`owner`: ask Shaked with the `owner-question` template of the `reply-style` skill.

Allowed without asking:
- Close a shipped issue as completed, after you read its last HANDOFF: it says `done`, has `RELEASE`, and its PR is
  merged. A HANDOFF that says not started, waiting, stopped, partial or blocked keeps the issue open.
- Add a missing `Depends on: #n` line to an issue body. Change nothing else in the body.
- Add a label: `task` to a sub-issue with no label, `epic` to an issue with sub-issues.
- Link duplicates: comment on both, then close the newer one with the state reason `duplicate`. Only when the titles
  and bodies say the same work, both are in one epic, and the newer one has no CLAIM, HANDOFF or PR of its own
  (read its comments: the script says `dispatcher` when they are not loaded).

Never:
- Delete an issue, a comment or a label.
- Close unfinished work, or anything with an open question in it.
- Change a plan: the task text, its order, its executor, validator or scope. Remove `held` or `owner`.
- Close one of two overlapping tasks from different epics. List the overlap with the exact file, table and route
  names; the dispatcher decides.

Owner-only matters (money, secrets, deleting data, product behaviour no task decides) go to Shaked as an owner
question on the epic, with the label `owner`.

## Post the report
Post it as a comment on the task issue that asked for the run, in the `status-report` template of `reply-style`:
`TL;DR` with the counts, `Done` with the fixes you applied (each with its issue link and "checked"), and the
script output under `Details`. List what is left for the dispatcher and the owner. Run `npm run reply-lint` on it
before you post. The script output passes the lint on its own: each issue gets its 3 to 6 words the first time.

## Phase 2: run it by itself (design only)
Shaked asked for a run after about 10 new tasks, as a second phase (#458, 2026-11-25). Three options, checked
against `AGENTS.md` and the dispatcher rules in #154 (queue and dispatcher rules) on 2026-11-25:

| Option | How it starts an agent | Cost | What can go wrong |
|---|---|---|---|
| The dispatcher counts new issues on each pass | The dispatcher is already an agent: it runs this skill itself | One search call per pass: `created:>` the time of the last janitor report | Runs only while a dispatcher session lives. #154 says it polls its child about every 10 minutes, with a 2-hour cron watchdog; the 45 minutes in #458 is not in #154 |
| A workflow on `issues: opened` adds a `janitor-due` label to a tracker issue | It starts none: the dispatcher or the weekly review must notice the label | Actions minutes for every new issue (not checked) | A new workflow with `issues: write`; a label added with `GITHUB_TOKEN` starts no other workflow, so nothing is woken |
| A run inside the weekly review (#294 (weekly review skill file), #295 (weekly review check and workflow)) | The weekly review agent runs this skill | One run a week | Up to a week late: more than 20 issues were opened on 2026-11-25 alone (checked); #295 waits for #294 |

Pick: the dispatcher count, with the weekly review as a fallback once #295 ships. It needs no new workflow, token or
permission, and the count comes from GitHub search, so no counter can drift. The first build step is a
`janitor.mjs due` command that prints the number of issues opened since the last report comment, for the
dispatcher to compare with 10. The held task for phase 2 is #461 (janitor runs by itself).
