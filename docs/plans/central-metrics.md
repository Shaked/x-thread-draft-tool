# Central metrics and logs plan: one free place for dev, git, CI and production

Task #439 (epic #407). Planner: Opus, effort high. Plan only: nothing here is built yet.
Read and measured on 2026-11-25 between 22:28 and 22:40 UTC. Reviewed by a second Opus session on
2026-11-25 (12 findings, all taken in). Builds on `docs/plans/observability.md` (#331, PR 339) and
`docs/plans/speed.md` (#306). It does not repeat their decisions; it adds to them.

Owner request (Shaked, 2026-11-25, #439): one place that receives metrics and logs from development, Git,
CI and production. Free, no paid plan, 7 or 14 days are enough. Small enough to stay inside a free tier.
Reuse what exists. An agent reads it through our MCP and works out problems without the owner. Works for
this repo first and for other repos later. A person can read it too: a Telegram alert must say what it means.

Owner decisions recorded here:
- Shaked, 2026-11-25, #439 body: keep the defaults of #331 (Q1 to Q4 of `docs/plans/observability.md`
  section 8: no paid Vercel metrics, a scheduled step every 6 hours, no Web Analytics, no Neon API key).
- Shaked, 2026-11-25, in the #439 session: work without asking for permission where an agent can. Read as:
  no "may we start" question, no `held` label on these tasks, and no step that needs a person for each
  new repo.

## Short answer

The central place is our own Neon database, which already holds the app's metrics plan (#331, tasks O1 to
O7). This plan adds one small events table for CI, Git, deploys, speed stages and production errors, and
two admin tools that answer in plain English with the number, the limit and last week's value.

Nothing outside this repo sends anything. This repo's own 6-hourly workflow (O5) reads CI, Git and deploy
data from the GitHub API, for this repo and for every public repo listed in one file, and writes it in the
same database wake. A new repo joins with one line in that list: no workflow, no token and no permission
in that repo. Raw logs stay where they are (GitHub Actions); the table stores a link, never the log text.

Cost: $0 a month. No sign-up, no secret, no money. Size is capped by drop rules, fixed keys, a 14-day
retention job and a row-count guard (section 3). Neon's Free plan stops instead of billing (quoted in
section 2), so the risk is a stopped database, not a bill; the guards keep the events far from that stop.

No external service is recommended: each one needs a sign-up and a secret in our server, because our MCP
must answer. The fallback is a second free Neon project for the events (task M9, owner-only, because its
connection string is a secret), then Axiom's free plan once its over-limit behaviour is checked.

## 1. Requirements and what we really have

"Checked" means I counted it in this session and say how. "Not checked" means I did not.

### Sources and signals

| Source | Metrics | Logs | Traces | Where it lives today | Agent can read it today |
|---|---|---|---|---|---|
| Local dev (a person's or an agent's machine) | pre-commit time, test counts | test output | no | the terminal only | no |
| Git | commits, merges, PR open to merge time | commit and PR text | no | GitHub | yes, GitHub MCP |
| CI (GitHub Actions) | run time, queue time, result per workflow, job and step | job logs, about 1 MB for a unit test job | no | GitHub (retention up to 90 days for a public repo; this repo's setting not checked) | logs yes (GitHub MCP `get_job_logs`); speed numbers no, they sit in an artifact |
| Speed (per merge) | the four stages of `docs/plans/speed.md` | no | no | `speed-metrics` artifact, job log | partly: the job log since PR 437 |
| Deploys (Vercel) | deploy time, result | build log | no | GitHub Deployments API (written by Vercel), Vercel | yes, GitHub MCP |
| Production app | requests, latency, errors per route and tool | the `[perf]` line per request | not built; the `[perf]` line has per-request DB time | Vercel runtime logs, kept 1 hour on Hobby (checked 2026-11-21 in #331) | no; O1 to O4 will add it |
| Vercel platform | function duration, memory | runtime logs | no | Vercel, needs Observability Plus (HTTP 402, checked 2026-11-21 in #331) | no |
| Neon | database size, CU-hours | Postgres logs | no | Neon console, 1 day of monitoring on Free (quoted in section 2) | size by SQL; CU-hours not (owner kept "no Neon API key", Q4 of #331) |

Traces: not now. One request makes 0 to about 5 SQL queries, and the `[perf]` line already splits total
time from DB time. Axiom and Sentry both list OTLP trace ingest (section 2) if a later need shows up.

Local dev is not collected. A machine has no identity without a secret on it, and CI runs the same
pre-commit checks on every push. Decided by Opus, 2026-11-25.

### Volume, counted

| What | Count | How it was counted | Status |
|---|---|---|---|
| Commits on `main` | 295 in 7 days (2026-11-18 to 11-24); 18 to 108 a day | `git log origin/main --since --until`, full history fetched | checked |
| Merged PRs | 104 in 7 days; 6 to 34 a day | same, `--merges` | checked |
| Workflow runs, all workflows | 2 638 in 7 days; 2 to 1 113 a day (1 113 on 2026-11-19) | every run listed with the GitHub MCP `list_workflow_runs`, counted by day and workflow | checked |
| Of those: `Codex gate` | 1 089 (525 cancelled, 272 skipped) | same | checked |
| Of those: `Tests` | 273 (220 success, 25 failure, 28 cancelled) | same | checked |
| Of those: `Notify labels (Telegram)` | 156 | same | checked |
| Of those: `Smoke test (deployed)`, one per production deploy | 86 | same | checked |
| Runs started by a `deployment_status` event | 154 in 7 days | same, by event | checked |
| Jobs per `Tests` run | 4 or 5, 34 steps | `list_workflow_jobs` on 3 runs | checked |
| One unit test job log | 7 159 lines, about 1 MB (689 939 bytes in the 5 000 lines returned) | `get_job_logs` on one job | checked (partly: the tool returned 5 000 lines) |
| One smoke job log | 308 lines | same | checked |
| `speed-metrics` artifact | 1 007 to 2 856 bytes | `list_workflow_run_artifacts`, 5 runs | checked |
| MCP calls in production | 6, 12, 149, 9 a day on the 4 days with any calls since 2026-11-19 (1 user) | read-only SQL: `sum(calls)` from `mcp_rate_limits` by day | checked |
| `[perf]` lines in production | 82 in one hour at night | Vercel runtime logs, 2026-11-21 (#331) | checked then, not checked again (Vercel tools are not used in this task) |
| One `[perf]` line | 119 to 138 bytes | built from the code in `server/perf.js` with sample values | checked (sample values) |
| Production database size | 9 617 408 bytes (9.6 MB) of the free 1 GB, 9 users | read-only SQL `pg_database_size` | checked |
| Local dev runs | unknown | no record exists | not checked |

### What the central place must hold

| Signal | Rows, worst seen | Kept |
|---|---|---|
| One event per CI run that ran, for listed workflows; skipped and cancelled runs are only counted | at most 1 113 a day (the busiest day, before any drop rule) | 14 days |
| One Git event per merge | at most 34 a day | 14 days |
| Speed: one row per merge and stage (5 stages) | at most 34 × 5 = 170 a day | 14 days |
| One event per deploy (preview and production) | at most 154 a day (this is the 7-day total, used as a safe upper bound) | 14 days |
| Production errors (5xx, thrown errors) | at most 200 a day (an SQL cap, section 3) | 14 days |
| Daily counters per repo, source, kind, name and result | at most 200 rows per repo a day (a cap) | 400 days |
| App latency rollup | O1 table, worst case about 450 keys an hour (#331 section 3) | 14 days hourly, 400 days daily |

Worst case for the events table, one repo: (1 113 + 34 + 170 + 154 + 200) rows × 14 days ≈ 23 400 rows.
At about 500 bytes a row with its indexes (an estimate; M1 measures it), that is about 12 MB. With the O1
rollup's worst case (about 166 MB, #331) the total stays under 20 % of 1 GB. Skipped and cancelled runs
are at least 825 of the week's 2 638 (Codex gate 797, Tests 28; other workflows not counted).

## 2. Options compared

Every vendor fact below was read on 2026-11-25. During the reading, this session's network allowed
github.com but not the vendors' own sites: grafana.com, axiom.co, betterstack.com, honeycomb.io,
sentry.io, vercel.com, docs.github.com, opentelemetry.io and neon.com all failed to resolve. So I read,
where it exists, the vendor's own docs source on GitHub (the files their docs site is built from), and
Neon's page through Neon's own read-only docs tool. "Not checked" means neither route worked. Those hosts
were added to the environment's allowed hosts at about 22:42 UTC, so the next session can read the live pages
and replace each "not checked" (task M0).

### What each option says, quoted

**Neon Free (our database).** Source: https://neon.com/docs/introduction/plans, read with the Neon docs
tool `get_doc` (page "Last updated: 2026-11-24").
- Limits: "100 CU-hours/project/month", "1 GB/project, 20 GB account total", "5 GB per project included"
  (public network transfer), monitoring "1 day", metrics and logs export "Not available" on Free.
- At the limit: "On the Free plan, when you run out of CU-hours, your compute is suspended until the next
  billing period or until you upgrade." and "Exceeding the 1 GB per-project storage cap ... causes
  operations that increase storage (inserts, updates, and deletes) to fail until you free space or
  upgrade." and "None of these limits delete your data."
- Billing: "On the **Free** plan, there is no monthly cost." No automatic billing.

**Grafana Cloud Free (Mimir, Loki).** Limits, retention and over-limit behaviour: not checked
(grafana.com did not resolve; no Grafana Cloud docs source found on GitHub). MCP: read
https://github.com/grafana/mcp-grafana. It is "A Model Context Protocol (MCP) server for Grafana", run
locally with `uvx mcp-grafana` and `GRAFANA_SERVICE_ACCOUNT_TOKEN`; "For Grafana Cloud, replace
`GRAFANA_URL` with your instance URL". Tools include `query_prometheus` and `query_loki_logs`.

**Axiom (Personal plan).** Source: Axiom's docs source,
https://github.com/axiomhq/docs/blob/main/content/docs/(documentation)/reference/limits.mdx.
- Limits: "Always Free data loading | 500 GB / month", "Always Free query compute | 10 GB-hours / month",
  "Maximum data retention | 30 days", "Datasets | 3", "Users | 1".
- At the limit: the page says "If you're on the Axiom Cloud plan and you exceed the Always Free allowances
  outlined above, additional charges apply". What happens on Personal is not stated: not checked.
  A spending limit exists (`reference/usage-billing.mdx`): "When your accumulated charges reach your
  spending limit, Axiom automatically pauses actions that generate further costs." Whether Personal
  can be charged at all: not checked.
- Vercel (`apps/vercel.mdx`): "Axiom automatically installs a drain in your Vercel account" and "In May
  2024, Vercel introduced higher costs for using Vercel Drains."
- OTLP (`send-data/opentelemetry.mdx`): "Traces: `https://AXIOM_DOMAIN/v1/traces`", "Logs:
  `https://AXIOM_DOMAIN/v1/logs`", "Metrics: `https://AXIOM_DOMAIN/v1/metrics`", with
  "authorization: Bearer API_TOKEN".
- MCP (`console/intelligence/mcp-server.mdx`): hosted at "`https://mcp.axiom.co/mcp`"; "Remote MCP with
  OAuth is the recommended setup for most use cases."

**Better Stack.** Limits, retention, over-limit behaviour, Vercel and OTLP: not checked (betterstack.com
did not resolve). GitHub (https://github.com/BetterStackHQ) shows plugin repositories whose description
mentions "the Better Stack MCP server"; the server itself was not read.

**Honeycomb.** Limits and over-limit behaviour: not checked (honeycomb.io did not resolve). The old
self-hosted MCP (https://github.com/honeycombio/honeycomb-mcp) says "DEPRECATED: This self-hosted MCP
server is deprecated" and "Currently, this is only available for Honeycomb Enterprise customers." The
hosted MCP and its plan: not checked.

**Sentry (Developer, free).** Source: Sentry's docs source, https://github.com/getsentry/sentry-docs
(`docs/pricing/index.mdx`, `docs/pricing/quotas/index.mdx`, `docs/concepts/otlp/index.mdx`).
- Developer plan numbers: not checked; the source says only "The free Developer plan has similar presets."
- At the limit: "Any data sent after you've run through your reserved volume and PAYG budget will be
  dropped and you won't be charged for it." and "Events and attachments that exceed your quota will not
  be accepted".
- OTLP: "Sentry can ingest OpenTelemetry traces and logs via OTLP endpoints" and "Sentry does not support
  OTLP metrics at this time." Which plans include it: not checked.
- MCP: hosted, "url": "https://mcp.sentry.dev/mcp", with OAuth (https://github.com/getsentry/sentry-mcp).

**OpenTelemetry Collector plus a free backend.** https://github.com/open-telemetry/opentelemetry-collector:
"The OpenTelemetry Collector offers a vendor-agnostic implementation on how to receive, process and export
telemetry data." Licence "Apache-2.0". It is a long-running process; we have no always-on host (Vercel
functions end with the request). A free host for it: not checked. It still needs one of the backends above.

**GitHub Actions artifacts and job summaries only.** Source: GitHub's docs source, https://github.com/github/docs.
- "usage is free for standard GitHub-hosted runners in public repositories" (`data/reusables/actions/actions-billing.md`).
- "For public repositories, you can configure a period between 1 and 90 days." (artifact and log retention)
- "each step is restricted to a maximum size of 1MiB" (job summaries, `workflow-commands.md`).
- "In a public repository, scheduled workflows are automatically disabled when no repository activity has
  occurred in 60 days." (`data/reusables/actions/scheduled-workflows-disabled.md`)
- Whether the REST API downloads an artifact without a token: not checked. PR 437 found that the working
  session could not download the `speed-metrics` artifact.

**Vercel (our plan: Hobby).** From #331 (checked 2026-11-21): runtime logs kept 1 hour; every metrics query
answers 402 "Observability Plus is required". Which plans may create drains, and their price: not checked.

### Against the requirements

| Option | Free limit and retention | Ingest from GitHub Actions | Ingest from Vercel | Agent reads it through our MCP | Lock-in | At the free limit | Verdict |
|---|---|---|---|---|---|---|---|
| Neon tables (ours) | 1 GB, 100 CU-hours a month; retention is ours to set (14 days) | our own scheduled workflow reads the GitHub API, OIDC route, no secret (O5 pattern) | the app writes its own rollup (O2); deploys from the GitHub Deployments API | yes: new admin tools | none: plain Postgres | stops: compute suspended or writes fail; no bill | **recommended** |
| Grafana Cloud Free | not checked | needs a token (a secret) | drain (plan not checked) or app code with a token | no: its own MCP, local, with a token | low: PromQL and LogQL are open | not checked | no: limits and billing not checked |
| Axiom Personal | 500 GB a month, 30 days | needs a token | drain (Vercel's price not checked) or OTLP from our code with a token | no: its own MCP (OAuth); ours could proxy with a token | medium: APL query language | not checked for Personal | fallback 3, owner-only |
| Better Stack | not checked | not checked | not checked | not checked | not checked | not checked | no: nothing read |
| Honeycomb | not checked | not checked | not checked | not checked | low (OTLP) | not checked | no: nothing read |
| Sentry Developer | numbers not checked | needs a DSN and an account | SDK in our code | no: its own MCP (OAuth) | medium | drops, no charge (quoted) | no: errors and traces only, no metrics over OTLP, no CI |
| OTel Collector + backend | the backend's | needs a host (none free, not checked) | same | the backend's | low | the backend's | no: needs a host and a backend |
| GitHub artifacts and summaries only | up to 90 days, free in a public repo | built in | deploys only | no: artifacts not readable from a session; logs are, with the GitHub MCP | none | free in a public repo (quoted) | keep as the raw log store, not as the central place |

## 3. Recommendation

**Neon tables, with links to GitHub for raw logs.** It needs no sign-up and no secret, and it reuses the
#331 design: the same database, the same OIDC check (O5), the same admin tool pattern (O4), the same
Telegram sender. Two parts of the request are left out on purpose: local dev (section 1) and Hebrew text
(section 4).

### How it works

- **App metrics** stay exactly as #331 plans (O1 to O7): an hourly histogram rollup per route and tool.
- **Events** (new): one table `ops_events` for everything that is not a request: a CI run, a merge, a
  deploy, the speed stages of a merge, a production error. One row per event, a fixed set of fields
  (below), and a link to the place where the raw log already lives.
- **Sources list**: `server/ops/sources.js` lists each repo (owner, name and numeric `repository_id`) and,
  per repo, the workflows that get rows and whether speed rows are made (`speed: true` only for this repo:
  `speed-metrics.mjs` knows this repo's workflow names). Another public repo joins with one line here: nothing changes
  in that repo. A private repo would need a token to be read: not now.
- **Collect**: `scripts/ops-emit.mjs` runs as a second step of O5's 6-hourly workflow `metrics-daily.yml`
  (owner default Q2 of #331). For each listed repo it reads the GitHub API (runs, merges, deployments, and
  the speed stages through the functions of `scripts/speed-metrics.mjs`) and posts one batch. It shares
  O5's database wake, so it costs no extra compute, however many repos are listed.
- **Cursor**: per repo, the route keeps the creation time of the oldest run that was still going at the
  last fetch, or else of the newest run it stored (`ops_cursor`), and returns it in every answer. The
  script's first call per repo is an empty batch, to read the cursor; it then lists runs created from one
  hour before it (the list-runs API filters by creation time; whether it can filter by completion time:
  not checked, M3 checks) and keeps only completed runs. A run still going is picked up by a later fetch,
  because the cursor stays at or before it. The insert ignores an event it already has (unique key), so a
  late or repeated run adds nothing twice.
- **Counters**: skipped and cancelled runs, and runs of unlisted workflows, are counted per finished UTC
  day. The script recomputes each finished day from the API and replaces that day's counter rows, so a
  repeated run never counts twice.
- **Production errors**: the O2 recorder adds an error event (route template, status, error class name,
  short code, region) to the pending batch it writes after the answer. No message text, because an error
  message can hold user data.

### The ingest route and its token (task M2)

`POST /api/ops/events` is called only by this repo's `metrics-daily.yml`. It is not a `ci: true` route,
and the workflow is not added to `CI_WORKFLOW_PATHS` (the O5 rule). The route verifies the GitHub OIDC
token itself (same issuer, key set and age as `verifyCiToken`) and requires all of:
- audience `x-thread-draft-tool-ops-events-<VERCEL_ENV>`, built like `ciAudience` in `server/oidc-ci.js`,
  so a production token does not pass on preview. O5's route gets its own audience,
  `x-thread-draft-tool-ops-daily-<VERCEL_ENV>`, instead of the CI audience (this changes O5's text in
  `docs/plans/observability.md` and #336). The workflow asks for one token per audience and targets
  production only, so each token works on one route of one environment;
- `repository_id` of this repo (a number, so a renamed or re-created repo cannot pass);
- `workflow_ref` and `job_workflow_ref` both equal to
  `Shaked/x-thread-draft-tool/.github/workflows/metrics-daily.yml@refs/heads/main`, so a branch with an
  edited workflow cannot post, and a manual run only runs the code on `main`;
- `event_name` `schedule` or `workflow_dispatch`;
- `runner_environment` `github-hosted`.

Tests: the ops token is refused on O5's route, on `ci: true` routes and with another audience; the smoke,
upload and O5 tokens are refused here; a token from a branch ref is refused.

### How size is capped

| Rule | What it stops |
|---|---|
| Drop: a CI run with result `skipped` or `cancelled` is only counted | at least 825 of 2 638 runs in the measured week |
| Drop: only listed workflows get rows; others are counted under their listed name or `other` | label and notify runs (156 in the week) |
| Fixed fields: `name` comes from the repo's listed workflows, the stage list or the route templates, else `other`; `attrs` takes only the keys listed for its kind; every string is cut to 120 characters; the whole object is at most 1 KB | log text, long titles, unbounded keys |
| Link rule: `link` must start with `https://github.com/<the repo of the event>/`, else it is dropped | links of the sender's choice on the admin page and in Telegram |
| Time rule: `at` must be between 14 days ago and 10 minutes from now, else the event is refused | rows that would escape retention |
| No log text: the row holds a link to the run, job or deploy | about 1 MB per unit test job log |
| Batch cap: at most 500 events per request, else 413 | a runaway sender |
| Daily caps: at most 5 000 events and 200 counter rows per repo per UTC day | a loop or a very busy repo |
| Row guard: if `ops_events` holds over 100 000 rows (`count(*)`, fast at this size), new events are refused and alert A3 (capacity, #331) fires. A row count goes down after the retention delete; a table size in bytes does not without `VACUUM FULL` | the table ever reaching Neon's 1 GB stop |
| Retention: the 6-hourly step deletes events older than 14 days and counters older than 400 days | growth over time |
| Production errors: at most 20 per function instance per hour, only from a request that already used the database (the O2 rule), and at most 200 a day: the insert counts today's error rows in the same statement | an error storm waking or filling the database |

Neon compute: the collect step shares O5's wake (4 a day, about 0.08 CU-hours a day, #331), whatever the
number of repos. An agent's read can wake the database: about 5 minutes at 0.25 CU, so about 0.02
CU-hours per cold read; 100 reads a month is about 2 CU-hours of the free 100. Estimate, not measured.

GitHub API calls: per repo and run of the step, a few list calls plus one jobs call per failed run (for
`failed_job` and `failed_step`; `queue_ms` comes from the run itself). 25 failed `Tests` runs in the
measured week. The rate limit of the workflow token: not checked; M3 reads it from the API's rate-limit
headers and stops cleanly, keeping the cursor, when fewer than 100 calls remain.

### Event shape (version 1, defined once in `server/ops/events.js`)

```json
{
  "v": 1,
  "repo_id": 1234567,
  "events": [
    {
      "source": "ci",
      "kind": "run",
      "id": "45713676980.1",
      "at": "2026-11-25T22:29:45Z",
      "name": "Tests",
      "status": "failure",
      "ms": 97000,
      "attrs": { "event": "pull_request", "queue_ms": 2000, "failed_job": "E2E tests (playwright)", "failed_step": "Install Playwright browsers" },
      "link": "https://github.com/Shaked/x-thread-draft-tool/actions/runs/45713676980"
    }
  ]
}
```

Example values. `repo_id` must be in the sources list. The unique key is (repo, source, kind, id).

| source | kind | id | name | status | ms | attrs keys |
|---|---|---|---|---|---|---|
| `ci` | `run` | run id and attempt | listed workflow name | `success`, `failure`, `timed_out` | run time | `event`, `queue_ms`, `failed_job`, `failed_step`, `pr` |
| `git` | `merge` | merge commit sha | base branch | `merged` | PR open to merge | `pr`, `files`, `docs_only` |
| `speed` | `merge` | merge commit sha and stage, `<sha>:ci` | `ci`, `merge_wait`, `vercel`, `smoke`, `total` | `ok`, `over` | stage time | `limit_ms`, `pr` |
| `deploy` | `deploy` | GitHub deployment id | `Production` or `Preview` | `success`, `failure` | created to success | `sha` |
| `prod` | `error` | instance id and sequence | route template | HTTP status | request time | `error`, `code`, `region`, `tool` |

The `speed` rows make the speed numbers readable through our MCP. Today they sit in the artifact.

### Fallback, in order

1. Retention 7 days instead of 14 (the owner said 7 is fine). A one-line change; no owner step. The
   baselines need 14 days of events for the `7d` window and 8 days for `24h` (the window plus the 7 days
   before it), and the daily counters hold counts, not the stage times a percentile needs. So with 7 days
   kept, the summary sets `baseline` to `null` where the history is too short, and its text says
   "no baseline: events are kept 7 days" instead of a number.
2. A second free Neon project only for `ops_*` tables, so a full events table can never stop the product
   database. Task M9, owner-only (a new connection string is a secret). Start it only when `ops_events`
   holds over 50 000 rows or the database uses over 70 of its 100 CU-hours in a month.
3. Axiom Personal for raw logs and traces, after its pricing page confirms that the Personal plan cannot
   bill. Owner-only (sign-up and a token). No task now.

## 4. How an agent reads it

Two capabilities, each on all three surfaces (AGENTS.md rule), each with its row in
`docs/architecture/capabilities.md`. Admin only, like every `/api/admin/*` route: 404 to everyone else,
the tools hidden from non-admins and bound to their own route (#298). The MCP tools call the REST route
in-process; the UI calls the same route.

| Capability | API | MCP | UI |
|---|---|---|---|
| Admin ops summary | `GET /admin/ops/summary` | `admin_ops_summary` | `/admin/*` (a "Delivery and CI" section on `/admin/metrics`, O6) |
| Admin ops events | `GET /admin/ops/events` | `admin_ops_events` | `/admin/*` (the table under that section) |
| Ops ingest (Infrastructure row, under O5's `/ops` gate) | `POST /ops/events` | none | none |

### `GET /api/admin/ops/summary?window=24h|7d&repo=<listed repo>`

One function, `server/ops/summary.js`, builds every line, so the REST answer, the tool text and the page
say the same words. Each finding has the number now, the limit when there is one, the same number for the
7 days before the window (the baseline), since when it has been over, and a link.

Example answer of the tool (example values, not measured):

```text
Ops summary for Shaked/x-thread-draft-tool, last 24 hours, as of 2026-11-26 06:00 UTC (events up to 05:40 UTC).
- Speed: 1 in 10 merges took 3 min 38 s or more from push to tested production. Limit 2 min 30 s. Last week 2 min 50 s. Over since 2026-11-24 14:10 UTC (7 merges).
- CI checks: 41 runs, 3 failed (7 %). Last week 9 %. Most failures: Tests, step "Install Playwright browsers" (2). Last failure: https://github.com/Shaked/x-thread-draft-tool/actions/runs/1
- Deploys: 6 to production, all passed the smoke test. Median 22 s from merge to live. Last week 22 s.
- Production: 1 950 requests, 0 server errors. Slowest 5 %: 120 ms or more. Last week 95 ms.
- Database: 11 MB of 1 GB (1 %).
Nothing else is over its limit.
```

The structured part (`structuredContent` for MCP, the JSON body for REST):

```json
{
  "as_of": "2026-11-26T06:00:00Z",
  "events_until": "2026-11-26T05:40:00Z",
  "window": "24h",
  "findings": [
    {
      "area": "speed",
      "text": "1 in 10 merges took 3 min 38 s or more from push to tested production.",
      "value": 218, "unit": "s", "limit": 150, "baseline": 170,
      "over": true, "since": "2026-11-24T14:10:00Z", "count_over": 7,
      "link": "https://github.com/Shaked/x-thread-draft-tool/actions/workflows/speed-metrics.yml"
    }
  ]
}
```

`baseline` is the same statistic (here the p90) over the 7 days before the window.

Rules for the text: short sentences; numbers with units; "1 in 10" instead of "p90", "slowest 5 %" instead
of "p95", both with "or more" (nearest rank); each line starts with the area; "Nothing else is over its
limit." when that is true; when the events are older than 7 hours, the first line says so and gives the
manual run link.

### `GET /api/admin/ops/events?source=&kind=&status=&name=&since=&limit=`

At most 100 rows, newest first, with `link`. For the agent's second step: find the failing runs, then
read their logs with the GitHub MCP (`get_job_logs`).

### Languages and clients

English only. `docs/architecture/client-matrix.md` leaves admin tools out on purpose ("one user, English
only"), and the owner reads Telegram in English (`telegram-message.md`). So no Hebrew text and no matrix
rows; the capabilities rows are required. The tool descriptions follow the existing admin tools.

## 5. Reuse across repos: two general skills (design only)

Both skills are written in task M8, after the routes and tools exist, so they name real tools.

### Skill "emit metrics" (`.claude/skills/ops-emit/SKILL.md`)

For a repo that wants its CI, Git and deploy numbers in the central place.

1. A public repo: add one line to `server/ops/sources.js` in this repo (owner, name, `repository_id`,
   the workflows that get rows) by a PR. Nothing changes in the other repo. The next 6-hourly run reads it.
2. The event shape version 1 (section 3) and its caps. The skill lists the kinds and the `attrs` keys.
3. What never goes in: secrets, user data, real paths with ids, log text, commit or PR bodies. Titles
   are cut to 120 characters.
4. For a web app's own runtime numbers: the histogram rollup pattern of #331 (O1, O2) in that app's own
   database: one row per hour and route, a fixed 65-bucket histogram, a write only when the request
   already used the database. Sending runtime numbers from another app into ours is not in this plan.
5. Check: `node scripts/ops-emit.mjs --dry-run --repo <owner/name>` prints the batch it would send.

### Skill "read and act on metrics" (`.claude/skills/ops-read-act/SKILL.md`)

For an agent that is asked "is anything wrong?" or that receives an alert.

1. Call `admin_ops_summary` with `window: 24h`. If `events_until` is older than 7 hours, start the
   `metrics-daily.yml` workflow by hand (GitHub MCP `actions_run_trigger`) and read again.
2. For each finding with `over: true`, call `admin_ops_events` for that area and read the linked runs
   with the GitHub MCP (`get_job_logs`, the failed step only).
3. Name one cause, with evidence, from a fixed list: a slow setup step, a flaky test (passed on re-run),
   a real failure, a slow external service, more traffic, unknown.
4. Act by the existing rules: a speed limit follows the Opus diagnosis rule in AGENTS.md (PR 441); a
   failing test gets a fix PR, never a skip; a capacity alert gets the fallback of section 3; only money,
   secrets and product decisions go to the owner.
5. Report with the `reply-style` templates: a status report, or an incident for production.

## 6. Alert text for Telegram

This replaces the one-line speed message. Today the owner gets the headline "Speed budget over limit"
and the line "p90 over the limit: CI, Smoke, Total" with a link to the run
(`scripts/speed-metrics.mjs`, `alert()`). It does not say how much, since when, why, or what to do.

The shape is close to `.claude/skills/reply-style/templates/telegram-message.md` (at most 5 lines, the bold
linked headline, `Needs you:` or `Nothing needed.`, links), written with `pstack-unslop`. An alert has no
item line (a commit or an issue title); the number takes its place. So M7 adds a second shape, "Alert",
to that file, with golden tests, and the speed kind uses it. O7's `metrics` kind uses it when O7 is built.

```text
**[<What is over, in plain words>](<the page with the numbers>)**
<The number now> against a limit of <limit> (<n> % over), since <UTC date and time> (<count> in a row).
Likely cause: <one cause and its evidence>.   [or: "Likely cause: not known yet."]
Nothing needed. <who acts and where>.   [or: "Needs you: <one action>."]
[<Second place to look>](<url>) · [What this number means](<doc url>)
```

Rules:
- Line 1 names the thing a person knows ("Delivery is slower than its limit"), not the metric ("p90").
- Line 2 is the number, the limit, how much over, and since when. Times in UTC. A percentile is said as
  "1 in 10 ... or more" (p90) or "1 in 20 ... or more" (p95).
- Line 3 is one cause with its evidence in a few words, or "not known yet".
- Line 4 is `Nothing needed.` with who acts, or `Needs you:` with the only action.
- Line 5 holds at most two links: where to look, and the doc that explains the number.
- Who acts is real: the same workflow opens or updates one speed gate issue (label `task`), which the
  AGENTS.md speed rule hands to Opus for a diagnosis, and the headline links that issue.
- When it is sent: by the per-merge run of `speed-metrics.yml`, once when a streak over the limit starts,
  and again only after the stages have been within their limits for 24 hours (the O7 rule). The
  streak and the "last sent" time are read back from the gate issue, so no new state is stored.

### Worked example: the speed budget

Example values, built from the baseline of `docs/plans/speed.md` (data of 2026-11-20), not from the
message the owner received. Checked with `npm run reply-lint -- --kind=telegram`.

```text
**[Delivery is slower than its limit: CI checks and the total](https://github.com/Shaked/x-thread-draft-tool/issues/1)**
1 in 10 merges took 3 min 38 s or more from push to tested production. The limit is 2 min 30 s (45 % over), since 2026-11-24 14:10 UTC (7 in a row).
Likely cause: CI checks took 2 min 49 s against 1 min 30 s; the end-to-end test setup downloaded fonts slowly in 3 runs.
Nothing needed. Opus diagnoses it on the linked issue, then an agent opens the fix PR.
[Speed table](https://github.com/Shaked/x-thread-draft-tool/actions/workflows/speed-metrics.yml) · [What the stages mean](https://github.com/Shaked/x-thread-draft-tool/blob/main/docs/plans/speed.md#1-definitions)
```

What M7 builds in `scripts/speed-metrics.mjs` for this (none of it exists today):
- the streak: walk back over the recent production merges from the API until one is within the limit;
  "since" is the first merge of the streak, "in a row" its length;
- the likely cause: the slowest stage over its limit, and in it the step whose time is furthest above its
  median, from the jobs API (`/actions/runs/{id}/jobs`, one call per run of that stage);
- the gate issue: open or update one issue for the whole gate, labelled `task`, listing the stages over
  their limit, and link it; this needs `issues: write` in `speed-metrics.yml`, its only write permission;
- the plain stage names: "CI checks", "merge wait", "deploy", "smoke test", "the total".

## 7. Tasks

Every task: executor Haiku 5.5 unless the row says Sonnet (Sonnet also for a step Haiku fails twice), the
validator named in the row, Opus judges the PR before merge, Codex optional (#154). Rules: AGENTS.md.
Each PR keeps `docs/architecture/capabilities.md` true. Sub-issues of epic #407, each with its full task
text. No `held` label (owner, 2026-11-25): a task starts when the tasks it depends on are closed. The same
words remove `held` from O1 to O7 (#332 to #338), which M1 to M6 depend on; #331's question ("keep
defaults") is answered by the #439 body, and the hold was only "until the owner has talked about this plan". "Depends
on" lists issues that must be closed first. O1 to O7 (#332 to #338) are the tasks of #331.

| Task | Issue | What | Validator | Size | Depends on | PR body line |
|---|---|---|---|---|---|---|
| M0 | see #439 | Read the live vendor pages now allowed (Grafana, Axiom pricing, Better Stack, Honeycomb, Sentry pricing, Vercel drains, GitHub artifact download) and replace each "not checked" in section 2 with a quote and the date. Docs only | Opus | S | none | `Implements #439 Task M0` |
| M7 | see #439 | Telegram alert shape (section 6): the "Alert" shape in `telegram-message.md`; the per-merge speed run sends it once per streak (24 hours clear to send again) with the streak, likely cause, plain stage names and one gate issue (`issues: write`); golden tests; `docs/operations/telegram.md` | Sonnet | M | the Telegram code step of #369 | `Implements #439 Task M7` |
| M1 | see #439 | Migration (next free number after O1): `ops_events` (unique repo, source, kind, id), `ops_daily` counters, `ops_cursor`; `server/ops/events.js` (version 1 shape, kinds, `attrs` keys, cuts, link and time rules, caps) and `server/ops/sources.js`, unit tests; measure the row size | Opus (SQL) | S | O1 #332 | `Implements #439 Task M1` |
| M2 | see #439 | `POST /api/ops/events` with its own OIDC check (section 3), repo from the sources list, caps, row guard, cursor in the answer, insert that ignores known events, daily counter replace; Infrastructure row; token tests. Executor Sonnet (OIDC is security code) | Opus (OIDC) | M | M1, O5 #336 | `Implements #439 Task M2` |
| M3 | see #439 | `scripts/ops-emit.mjs` and its step in `metrics-daily.yml`: per listed repo, CI runs, merges, deploys and speed stages from the GitHub API since the cursor, drop rules, day counters, rate-limit stop, `--dry-run`; reuse `speed-metrics.mjs` functions; offline fixture tests | Opus (workflow token) | M | M2 | `Implements #439 Task M3` |
| M4 | see #439 | Production error events in the O2 recorder: route template, status, error class, code, region; 20 per instance per hour and 200 a day; no message text; tests (no real path, no text stored) | Opus (hot path) | S | O2 #333, M1 | `Implements #439 Task M4` |
| M5 | see #439 | `GET /api/admin/ops/summary`, `GET /api/admin/ops/events`, tools `admin_ops_summary` and `admin_ops_events` (route binding as in O4), `server/ops/summary.js` (plain lines with baseline and since), retention in O5's step, OpenAPI, capabilities rows (UI `no: planned in #439 Task M6` until M6), `docs/operations/admin.md` | Opus (admin) | M | M1, O2 #333, O4 #335, O5 #336 | `Implements #439 Task M5` |
| M6 | see #439 | "Delivery and CI" section on `/admin/metrics`: the summary lines and the events table with links; capabilities UI cells | Opus (design) | S | M5, O6 #337 | `Implements #439 Task M6` |
| M8 | see #439 | Write the two skills of section 5 (`ops-emit`, `ops-read-act`); list them in `CLAUDE.md` with `npm run docs:refresh` | Opus (design) | S | M3, M5 | `Implements #439 Task M8` |
| M9 | see #439 | **Owner-only.** Second free Neon project for `ops_*` tables (fallback 2). Start only when `ops_events` holds over 50 000 rows or the month uses over 70 CU-hours | owner, then Opus | S | the trigger above | `Implements #439 Task M9` |

The issue numbers are listed on #439 once the issues exist. M0 and M7 can start first: they need none of
the database work, and M7 fixes the alert the owner did not understand.

M9, what the owner does (only when its trigger fires):
- Automated route checked first: the Neon MCP can create a project, but the app would then need a new
  connection string, which is a secret, and only the owner sets secrets. So it is the owner's.
- Steps: in the Neon console (https://console.neon.tech/app/projects), click **New project**, name it
  `x-thread-ops`, keep the Free plan; copy its connection string; in Vercel, project
  `x-thread-draft-tool`, **Settings**, **Environment Variables**, add `OPS_DATABASE_URL` for Production
  and Preview. Our Neon organization is managed by Vercel (`managed_by: "vercel"`, #331), so the
  **New project** button may sit in the Vercel Storage tab instead: not checked.
- What it unblocks: the ops tables move to their own database, so they can never stop the product.

## 8. Questions for the owner

None. Every choice here is free and needs no secret, and the owner asked for work without permission
steps. M9 is the only owner step, and only when its trigger fires.
