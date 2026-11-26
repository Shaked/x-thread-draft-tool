---
name: metrics-read-act
description: Read a metrics service summary in plain lines, find what is a problem and its cause, open an issue with the numbers, report. Never changes a limit.
---

# Skill: Read and act on metrics

Use it when you are asked "is anything wrong?", or when an alert from the metrics service arrives.

## Before you start
0. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/metrics-config.mjs"`: it prints `app`, `repo`, `siteUrl` and `ingestUrl` from
   `.claude/agent-kit.json`. Use `repo` below. When this text shows `${CLAUDE_PLUGIN_ROOT}` unfilled, the script is
   `scripts/metrics-config.mjs` two folders above this file.
1. You need the admin tools of the service (`admin_metrics_summary`, `admin_metrics_events`) and the GitHub tools
   (`get_job_logs`, `actions_run_trigger`, `list_issues`, `issue_write`, `add_issue_comment`). A tool you do not have is "not checked": say so in the
   report and stop. Do not read the admin API with a browser or a guessed token.

## 1. Read the summary
Call `admin_metrics_summary` with `window: "24h"` and `repo` from the config. Answer, example values:

```text
Delivery events are old: the last one is from 2026-11-26 01:10 UTC. Run https://github.com/acme/sample-app/actions/workflows/c.yml by hand.
Metrics summary for acme/sample-app, last 24 hours, as of 2026-11-26 06:00 UTC (events up to 01:10 UTC).
- Speed: 1 in 10 merges took 3 min 38 s or more from push to tested production. Limit 2 min 30 s.
  Last week 2 min 50 s. Over since 2026-11-24 14:10 UTC (7 merges).
- CI checks: 41 runs, 3 failed (7 %). Last week 9 %. Most failures: Tests, step "Install packages" (2).
  Last failure: https://github.com/acme/sample-app/actions/runs/1
- Deploys: 6 to production, none failed. Median 22 s from deploy start to live. Last week 22 s.
- Production: 1,950 requests, 0 server errors. Slowest 5 %: 120 ms or more. Last week 95 ms.
- Database: 11 MB of 1 GB (1 %).
Nothing else is over its limit.
```

How to read it:
- Line 1 appears only when the events are old (over 7 hours) or there are none. Then the numbers below are not current.
- The header line says the repo, the window and the time of the newest event.
- Each `- ` line is one area: Speed, CI checks, Deploys, Production, Database. It gives the number, the limit when
  there is one, last week's value, and since when it is over.
- "1 in 10 ... or more" is the 90th percentile. "Slowest 5 %" is the 95th. Both are nearest-rank values.
- The last line says whether anything is over its limit.
- The same facts come as `findings`: `area`, `text`, `value`, `unit`, `limit`, `baseline` (last week), `over`, `since`,
  `count_over`, `link`. Use them for the numbers you copy into an issue, not your own arithmetic. A `link` that starts
  with `/` is relative to `siteUrl`: write it in full before it goes into an issue.

If line 1 says the events are old or none: start the workflow its link names, once, with `actions_run_trigger`
(`method: run_workflow`, `owner`, `repo` and `workflow_id` taken from the link, `ref` the default branch).
End your turn and read again when it has finished. Do not loop or sleep.
Events carry the time of the run, merge or deploy they describe, not the time of collection. So a quiet
repository can keep line 1 after a good run. Read the finished run: if it failed, that is the problem, so open an issue
with the run link. If it succeeded, list the repository's recent runs, merges and deploys with the GitHub tools. Only when
there are newer ones than the last event, the collector stores nothing: open an issue with the run link. Otherwise
note the quiet period for the delivery lines, open no issue for it, and go on to judge the Production and Database lines,
which come from current numbers and not from delivery events.

## 2. What counts as a problem
A line is a problem when:

| Area | Problem when |
|---|---|
| Any area | its finding has `over: true` |
| Speed | the line says "Over since" |
| CI checks | at least 3 runs failed and the failed share is at least 10 points above last week's |
| Deploys | at least one production deploy failed |
| Production | at least one server error, or the slowest 5 % is at least twice last week's value |
| Database | 70 % of the limit or more (a full free database stops writes) |
| Events | the manual run failed, or it succeeded and newer runs, merges or deploys exist than the last event |

These margins are this skill's own. They keep one flaky run from opening an issue. A project's agent rules may set
other margins, and then they win. When nothing is a problem, report that with the time you checked and stop. Open no issue.

## 3. Find the cause
For each problem, call `admin_metrics_events`, newest first, with `since` set to the window start and `limit` 20.
It has no `repo` filter, so for delivery rows (`ci`, `speed`, `deploy`) keep only those whose `link` starts with
`https://github.com/<repo>/`. A `prod` row has no link: it comes from the service's own app. Read its `name` (the route),
`status` and `attrs` (`error`, `code`, `region`, `tool`) instead:

| Area | Filters |
|---|---|
| Speed | `source: speed`, `status: over` |
| CI checks | `source: ci`, `kind: run`, `status: failure` (then again with `timed_out`) |
| Deploys | `source: deploy`, `name: Production`, `status: failure` |
| Production | `source: prod` |

Each delivery row has a `link`. For a CI run, read the failed step only: `get_job_logs` with `run_id`, `failed_only: true`,
`return_content: true` and `tail_lines: 100`. A full job log can be about 1 MB.

Name exactly one cause, with its evidence, from this list:

| Cause | Evidence |
|---|---|
| slow setup step | the failed or slowest step installs, downloads or starts something, and its time is far above its usual time |
| flaky test | the same commit has a later attempt of the same run (`<run id>.2`) that passed |
| real failure | the error is in the project's own code or test, and it fails on every attempt |
| slow external service | the log shows a timeout or an error status from a host the project does not run |
| more traffic | `admin_metrics_series` with `name: requests` shows the count well above the days before |
| unknown | none of the above fits. Say what you checked |

## 4. Act
- Look through the open issues (`list_issues`) for the same area first.
  If one is open, add a comment (`add_issue_comment`) with today's numbers. Do not open a second.
- Otherwise open one issue with `issue_write` (`method: create`), written from `templates/finding-issue.md` and checked with
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/finding-check.mjs" <file>`.
  If the project's rules require its reply templates for issues the owner reads, use the status report and put the five
  sections under its `## Details` as `###` headings. The check accepts both shapes. One issue per area.
- Never change a limit, a margin or what is measured, and never skip, disable or quarantine a test, to make a number pass.
- Follow the project's own agent rules (for example `AGENTS.md`) for who diagnoses and who fixes. Without such rules,
  stop at the issue: a fix is a separate task.
- Only money, secrets and product decisions go to the owner: label the issue for the owner, say why, keep working.

## 5. Report
Use the project's reply templates when the `reply-style` plugin or its templates are there: a status report, or an
incident when production has errors. Otherwise start with two lines: what is wrong or "nothing is over its limit",
then whether the owner must act. Name each number as "checked" (read from the summary at a time you give) or "not checked".
