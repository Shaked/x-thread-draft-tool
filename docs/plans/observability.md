# Observability plan: product metrics and percentiles in the admin panel

Task #331 (epic #273), task O0. Planner: Opus. Plan only: nothing here is built yet.
Read and measured on 2026-11-21 between 00:45 and 00:56 UTC with the Vercel and Neon MCP tools, read-only.
Owner request (Shaked, 2026-11-21): see every interesting number (p95, p99, maybe p99.9) through the admin
panel, the admin API and MCP; use Vercel if it already has them, else a free solution.

Short answer: on our plans, Vercel and Neon give us almost no history and no percentiles for free.
Vercel says "Observability Plus is required" (HTTP 402) for every metrics query, and keeps runtime logs
for 1 hour. Neon's usage API needs a paid plan. So the app records its own numbers: one small row per
hour per route, with a fixed latency histogram, in the Neon database we already have. That costs $0 a
month, needs no new service and no new secret, and gives p50 to p99.9 for any window up to 400 days.
The admin sees it on one page, one REST route pair and two MCP tools. Three alert kinds go to Telegram.

## 1. What we can read today, for free

"Checked" means I ran the call in this session and quote its answer. "Not checked" means I did not.
Ids: Vercel team `team_XZuLIpA3Z8i7cuKg0U7zoug8` (slug `shaked-klein-orbachs-projects`), project
`prj_8E7qxk3jTFgBa36o2JyWL628vJd0`; Neon org `org-shiny-dew-64356613`, project `winter-recipe-73479043`.

### Vercel (our plan: Hobby)

| Source | Call | Result | Status |
|---|---|---|---|
| Plan | `get_runtime_logs` with `since: 24h` | 400: "The hobby plan does not retain runtime logs for the requested time range ... Hobby retains 1 hour, Pro 1 day, and Enterprise 3 days without Observability Plus." So our plan is **Hobby** | checked |
| Metrics list | `get_observability_schema` | 100+ metrics, among them `vercel.request.count`, `vercel.function_invocation.count`, `.function_duration_ms`, `.ttfb_ms`, `.peak_memory_mb`, `.cpu_throttle_percent`, `vercel.request.fdt_*_bytes` (bandwidth), `vercel.speed_insights.*` (LCP, INP, CLS, TTFB), `vercel.firewall_action.count` | checked |
| Metrics query | `create_observability_query` for `vercel.function_invocation.function_duration_ms`, aggregation `p95`, last 24 h | 402: "Observability Plus is required to run this query ... available on Pro and Enterprise plans" | checked |
| Metrics query | same tool, `vercel.request.count`, aggregation `sum` | 402, same message. So not even plain counts are free on Hobby | checked |
| Percentiles in Vercel | docs: `vercel metrics` CLI shows `p95`, `p99` aggregations (https://vercel.com/docs/cli/metrics) | exist, but only with Observability Plus (above) | checked (docs + 402) |
| Runtime logs | `get_runtime_logs`, production, `since: 50m`, query `[perf]` | our `[perf]` JSON lines come back, one per request. 82 `[perf]` lines in the 59 minutes before 00:55 UTC (`group_by: source`) | checked |
| Log counts | `get_runtime_logs`, `group_by: level`, 55 min | `info` 72, `error` 7. All 7 errors are the same `pg` warning (below) | checked |
| Runtime errors | `get_runtime_errors`, `since: 7d` | 1 group: the `pg` "SECURITY WARNING: The SSL modes 'prefer', 'require', and 'verify-ca' are treated as aliases for 'verify-full'", count 264, first 2026-11-07, last 2026-11-21. It is written once per new function instance, so it is noise, not an error | checked |
| Web Analytics | `count_pageviews`, 7 days | 400 `web_analytics_not_enabled` | checked |
| Drains | `list_drains` | `[]`: no log or trace drain | checked |
| Drains on Hobby | | which plans may create a drain | not checked |
| Speed Insights | | whether it is on; its metrics need the same query API, which answers 402 | not checked |
| Deployments | `list_deployments`, build events | used by #306 (speed plan, 2026-11-20); not re-run here | checked in #306 |
| Usage and billing | `list_billing_charges` | not called: billing is the owner's | not checked |
| Function duration limit, invocation limits on Hobby | | | not checked |
| Vercel Blob usage (bytes, files) | needs a Blob store id; no listing tool for stores here | | not checked |

What this means: Vercel keeps our own `[perf]` lines for 1 hour, and nothing else useful is free.
A job that copies logs every hour would need a Vercel token (a new secret) and would lose data whenever
a GitHub schedule runs late. So Vercel is not the source of history.

Privacy note (checked): Vercel's own log metadata shows the full request path, for example
`GET /api/share/<token>.md` and `DELETE /api/drafts/<id>`. Our `[perf]` line has only the template
(`/share/:token`). Our metrics must use the template only and never copy Vercel's path.

### Neon (our plan: Free, through the Vercel integration)

| Source | Call | Result | Status |
|---|---|---|---|
| Plan | `list_organizations` | `plan: "free"`, `managed_by: "vercel"` | checked |
| Project | `describe_project` | `subscription_type: free_v3`; compute 0.25 CU fixed (min = max 0.25); `active_time_seconds` 129 328 (35.9 h, so about 9 CU-hours) since 2026-11-07; `data_transfer_bytes` 16 495 116 (16.5 MB); `branch_logical_size_limit` 1 GiB; `history_retention_seconds` 21 600; quota resets 2026-12-01 | checked |
| Free plan limits | https://neon.com/docs/introduction/plans (read with `get_doc`) | 100 CU-hours per project per month, 1 GB storage per project, 5 GB public network transfer per project per month, monitoring history 1 day, metrics and logs export only on Scale. Out of CU-hours or transfer: the compute is suspended until the next month | checked |
| Slow queries | `list_slow_queries` | error: "pg_stat_statements extension is not installed". Installing it is a database change; not done | checked |
| Consumption | `get_project_consumption` | 403: "included with Launch plans and above" | checked |
| Branch consumption | `get_branch_consumption` | docs of the tool: "Usage-based Launch, Scale, Agent, or Enterprise plans only" | not run (same 403 expected) |
| Table sizes | `inspect_database` `table-sizes` | 22 tables; largest `drafts` 192 kB, then `oauth_tokens` 56 kB, `users` 48 kB, `oauth_clients` 48 kB; `admin_audit` 16 kB; `mcp_rate_limits` 8 kB | checked |
| Connection counts | Neon console Monitoring page (1 day) | no read-only tool here returns it | not checked |

So from Neon, for free: database size (also with `pg_database_size()` in SQL, no API) and, by hand, the
`describe_project` totals. CU-hours are about 9 used of 100 this month, read by hand; the app cannot read
them without a Neon API key (a new secret).

### GitHub

| Source | Status |
|---|---|
| Actions runs, job timings, PR merge times, GitHub deployment statuses: the four delivery stages of #306 | checked in #306 on 2026-11-20 (50 PRs). `scripts/speed-metrics.mjs` (#310, not built yet) will write them to the `speed-metrics` artifact |
| Repository visibility: public (`gh api search/repositories`) | checked |
| Actions minutes for a public repository are free on standard runners | not checked (GitHub billing docs not read here) |

### Our own app

| Source | What it holds | Status |
|---|---|---|
| `[perf]` line (`server/perf.js`) | per request: method, route template, status, total ms, query count, DB ms, new connections, cold start, region, MCP method, tool name. Lives 1 hour in Vercel | checked (code and logs) |
| `[mcp] tools/list admin_list=...` line | one per tool list, with the reason when it is not the admin list | checked (code) |
| `admin_stats` (`server/admin/queries.js` `statsRow`) | users, suspended users, drafts, published drafts, posts, images, active API tokens, connected apps, active share links, MCP calls in 24 h and 7 d, active users in 24 h and 7 d, signups per day for 30 days | checked (code). Not called on production (rule) |
| `mcp_rate_limits` | MCP tool calls per user per minute, kept 8 days (`cleanupExpired`). No tool name | checked (code) |
| `admin_audit` | every admin action with outcome (`started`, `done`, `failed`, `refused`) | checked (code). Not queried on production |
| Created-at times | `users`, `drafts`, `share_tokens`, `api_tokens`, `oauth_grants`, `oauth_clients` have `created_at` | checked (migrations) |
| History of "active users per day" | not kept: `last_active_at` is overwritten, so a past day cannot be counted later | checked (code) |
| Failed sign-ins, refused suspended sign-ins | not recorded anywhere except as a status code in `[perf]` (1 hour) | checked (code) |

## 2. The interesting numbers

Source keys: **R** = the new hourly rollup (section 3), **D** = the new daily snapshot (section 3),
**S** = SQL on existing tables at read time, **G** = GitHub (`speed-metrics`, #310), **X** = not available
for free. Cost is $0 for everything below except X.

How many samples a percentile needs: a nearest-rank percentile `q` is only meaningful when about 10
samples lie above it, so n must be at least 10 / (1 − q). The API returns `null` below these counts:

| Percentile | Minimum samples |
|---|---|
| p50 | 20 |
| p90 | 100 |
| p95 | 200 |
| p99 | 1 000 |
| p99.9 | 10 000 |

Traffic today (checked once): 82 requests in one hour at night, including a smoke run. If that is a normal
hour, the whole app reaches 10 000 requests in about 5 days, so p99.9 is shown for "all routes, 7 or
30 days" and almost never for one route. The page says so instead of showing a fake number.

| Group | Number | Source | Already have the data? |
|---|---|---|---|
| Traffic | requests per hour and day, per route template | R | no (logs 1 h) |
| Traffic | MCP calls per method and per tool | R | no (`mcp_rate_limits` has no tool) |
| Traffic | MCP calls per client app family (Claude, ChatGPT, Grok, command line, other) | R (task O3) | no |
| Traffic | requests from the web app, API tokens, MCP, CI, signed-out | R (caller kind) | no |
| Latency | p50, p90, p95, p99, p99.9, max, mean, per route, per tool, per caller kind, per status class | R | no |
| Latency | DB time and query count per request (mean) | R | no |
| Latency | cold starts: count and share | R | no |
| Errors | 4xx, 429, 5xx per route; tool errors per tool | R | no |
| Errors | runtime error groups | Vercel `get_runtime_errors` (7 days, free, checked); not shown in the app (needs a Vercel token) | yes, by hand |
| Saturation | rate-limit hits (429) per route and per tool | R | no |
| Saturation | new DB connections per request (mean), DB size in bytes against the 1 GB limit | R, D (`pg_database_size`) | partly (size by hand) |
| Saturation | Neon CU-hours used this month (100 free) | X in the app (needs a Neon API key); by hand with `describe_project` | by hand |
| Saturation | Vercel function duration and memory, Blob bytes | X (Observability Plus / Blob store not checked) | no |
| Product | users, drafts, posts, images, tokens, connected apps, active share links (now) | S (`admin_stats`) | yes |
| Product | active users per day and per week, as history | D | no (overwritten) |
| Product | signups, drafts created, share links created, tokens created, apps connected per day | S (`created_at`), stored in D so deletes do not change the past | yes, except deleted rows |
| Security | suspended users (now and per day), admin actions per day by action and outcome | S, D (`admin_audit`) | yes |
| Security | sign-in errors: 4xx and 5xx on `/auth/*` routes | R | no |
| Security | refused sign-ins of suspended users as their own number | X: needs a new counter in the sign-in code. Not planned (the 3xx on the callback route is visible in R) | no |
| Delivery | feature to deploy time, stages (a) to (d), median and p90 | G (#306, #310) | yes, in GitHub |
| Browser | page load (LCP, INP, CLS) | X: Web Analytics off (checked), Speed Insights queries need Plus. Owner question Q3 | no |

## 3. Where to keep history

| Option | What | Cost per month | Effort | Limits |
|---|---|---|---|---|
| (a) Query on demand only | read Vercel and Neon when the admin opens the page | $0 | small | does not work on our plans: Vercel answers 402 and keeps logs 1 h; Neon usage API 403 |
| (b) **Rollup table in our Neon database** | the app adds each request to an hourly histogram row; a daily step writes a product snapshot | $0 | medium (5 small PRs) | uses our free Neon storage (estimate below) and a few ms of function time per request |
| (c) GitHub Actions artifact or JSON file | a scheduled job copies logs into an artifact | $0 | medium | needs a Vercel token (new secret); schedules can run late, so hours are lost; artifacts expire (90 days) |
| (d) Free hosted tool | send logs or metrics to a hosted service | not checked | medium | needs a drain (plan support not checked) or code that sends data out, plus a new secret. No free tier was verified in this session |

**Decision (Opus, 2026-11-21): option (b).** It is the only option that works on our plans today, costs
nothing, needs no secret and keeps user data in our own database. Running cost: $0 per month.

Storage estimate: one row per (hour, route, method or tool, caller kind, status class) that had traffic.
At most about 100 such keys in a busy hour; one row is about 400 bytes with its histogram. Hourly rows
are kept 14 days (at most 100 × 24 × 14 × 400 B ≈ 13 MB, in practice far less), then merged into daily
rows kept 400 days (at most about 16 MB). The 1 GB Neon limit stays far away; the daily step records the
database size so alert A3 sees it coming.

Neon compute: the write runs while the request's function is still alive and the database is already
awake, so it adds almost no active time. The daily step wakes the database once a day (at most 5 minutes
at 0.25 CU, about 0.02 CU-hours).

### The tables (task O1, migration `010_metrics.sql`)

- `metrics_hourly`: `hour` (UTC hour start), `route` (route template with method, `GET /drafts/:id`, or
  `unmatched`), `op` (`-`, an MCP method from the fixed list in `server/perf.js`, or `tool:<name>` for a
  known tool), `caller` (`web`, `token`, `mcp`, `ci`, `anon`; with O3, `mcp:claude`, `mcp:chatgpt`,
  `mcp:grok`, `mcp:cli`, `mcp:other`), `class` (`2xx`, `3xx`, `4xx`, `429`, `5xx`, and for a tool call
  `tool_error`), `n`, `sum_ms`, `max_ms`, `sum_db_ms`, `sum_q`, `sum_conn`, `cold`, `buckets int[]`.
  Primary key: the five dimensions.
- `metrics_daily`: the same columns with `day` instead of `hour`.
- `metrics_product_daily`: `day` primary key and one integer column per product and security number of
  section 2 (active users 24 h and 7 d, signups, drafts created, share links created, tokens created,
  apps connected, suspended users, admin actions done, failed and refused, database bytes).
- `metrics_alert_state`: `kind` primary key, `first_seen`, `last_sent`, `value`, so an alert is sent once,
  not every run.
- No foreign keys and no user id anywhere: a metric outlives every user.

### How a request is recorded (task O2)

- In `measured()` (`server/perf.js`), after the `[perf]` line, `waitUntil(recordRequest(store, status, ms))`
  from `@vercel/functions` (already a dependency). The answer is sent first; the write happens after.
- One statement per request: `insert ... on conflict (hour, route, op, caller, class) do update set
  n = n + 1, sum_ms = sum_ms + $ms, max_ms = greatest(...), buckets[$k] = metrics_hourly.buckets[$k] + 1`.
- A failed write is caught and logged as `console.warn('[metrics] write failed')` with no details; it
  never changes the answer. `METRICS_DISABLED=1` turns the write off (not a secret).
- The write is outside the request's `q` count, so `tests/api/query-budget.test.js` numbers stay the same.
- Every dimension comes from a fixed list in code (route templates from `ROUTES`, tool names from the
  tool list, the method set in `perf.js`, the caller kinds above). Anything else is stored as `other`.
  Real paths, ids, tokens, user ids, IP addresses and user agents are never stored.

### Percentiles: how they are computed

- Each row has a histogram of 65 counters. Counter 0 holds requests under 1 ms. Counter k (1 to 63)
  holds requests from 2^((k−1)/4) ms up to 2^(k/4) ms; counter 64 holds requests of 2^(63/4) ms
  (about 55 s) and longer. Each step is 19 % wider than the last.
- Any window and any grouping is the sum of the rows' counters, so hours, days, routes and tools merge
  exactly.
- Percentile q: nearest rank, as in the speed plan (`docs/plans/speed.md` section 1): rank
  `ceil(q × n)` (1-based) in the merged histogram. The value reported is the geometric middle of that
  counter's range, never more than the window's `max_ms`. The error is at most about 9 %.
- Below the minimum samples of section 2, the percentile is `null` and its name is listed in
  `low_samples`.
- `mean` is `sum_ms / n` (exact). `max` is the largest `max_ms` (exact).

### The daily step (task O5)

`POST /api/ops/metrics-daily`, called by a new workflow `.github/workflows/metrics-daily.yml` with the
GitHub Actions OIDC identity that the smoke test already uses (`server/oidc-ci.js`). No new secret.

- The workflow file is added to `CI_WORKFLOW_PATHS`, and the `schedule` event is allowed for this file
  only. The route answers 404 to every other caller, like the admin paths.
- It is idempotent and does, in order: write yesterday's (UTC) row of `metrics_product_daily` if it is
  missing (counts only, from the same tables as `statsRow`); merge `metrics_hourly` rows older than 14
  days into `metrics_daily` and delete them in the same transaction; delete `metrics_daily` rows older
  than 400 days; work out the alerts (section 6).
- It deletes metric rows only, never user data.
- It answers with counts and alert flags only.

## 4. How the admin sees it

Two capabilities, each on all three surfaces (AGENTS.md rule), each with its own row in
`docs/architecture/capabilities.md`. MCP tools call the REST route in-process; the UI calls the same route.

| Capability | API | MCP | UI |
|---|---|---|---|
| Admin metrics | `GET /admin/metrics` | `admin_metrics` | `/admin/*` (page `/admin/metrics`) |
| Admin metrics history | `GET /admin/metrics/series` | `admin_metrics_series` | `/admin/*` (chart on the same page) |

- Admin only, through `adminRoute` and the guard. The tools are in `ADMIN_TOOLS`, hidden from everyone
  else, and each tool may reach only its own route (the per-route binding of #298).
- `GET /api/admin/metrics?window=1h|24h|7d|30d|90d|400d&by=route|op|caller|class|all&route=<template>`:
  one entry per group, sorted by `count`, at most 200 entries.
- `GET /api/admin/metrics/series?name=<metric>&window=24h|7d|30d|90d|400d&route=<template>`: points per
  hour (windows up to 7 days) or per day. `name` is one of `requests`, `errors_5xx`, `errors_4xx`,
  `rate_limited`, `p50`, `p95`, `p99`, `cold_starts` (from R) or one column of `metrics_product_daily`.
- Product numbers "now" stay in `admin_stats`; the new routes do not repeat them.
- Delivery numbers stay in GitHub: the page links to the `speed-metrics` workflow runs (#310). No copy
  in the app (decided by Opus: one source for each number).

### The response shape (defined once, in `server/metrics/view.js`)

Example values, not measured:

```json
{
  "as_of": "2026-11-21T01:00:00Z",
  "window": { "name": "24h", "from": "2026-11-20T01:00:00Z", "to": "2026-11-21T01:00:00Z" },
  "metrics": [
    {
      "name": "latency",
      "group": { "route": "GET /drafts/:id", "op": "-", "caller": "all", "class": "all" },
      "window": "24h",
      "count": 1240,
      "errors": { "4xx": 3, "429": 0, "5xx": 0, "tool_error": 0 },
      "cold": 12,
      "p50": 8.4, "p90": 15.9, "p95": 22.4, "p99": 63.4, "p99_9": null,
      "mean": 10.2, "max": 210.0,
      "low_samples": ["p99_9"],
      "unit": "ms",
      "source": "app_rollup",
      "as_of": "2026-11-21T01:00:00Z"
    }
  ]
}
```

The current hour is included (`as_of` is the time of the read). Series points have the same fields
without `group`.

### The admin page (task O6)

- `/admin/metrics` in the lazy admin chunk of #285: a window switch (24 h, 7 d, 30 d), a summary row
  (requests, 5xx share, p95, p99, p99.9 for all routes), a table by route and one by tool, each with
  count, errors and p50 to p99.9 (`–` with "needs 10 000 samples" when `null`), and one line chart
  (requests and p95 per hour or day) drawn as inline SVG. No chart library.
- Components and colours from the design system of #305 (U1, U2) where they exist.
- A "Product" table from `metrics_product_daily` (last 30 days) and a link "Delivery speed" to GitHub.

## 5. Privacy and safety

- No user content, no draft text, no token or token hash, no real path, no id, no IP address, no user
  agent and no user id in any metric row. Every dimension comes from a fixed list in code; a test feeds
  a real path with an id and a token and checks that only the template is stored.
- Admin only: 404 to everyone else, as for every `/api/admin/*` path; tools hidden from non-admins.
- Rate limited: each admin call counts once in the normal MCP row (120 per minute), as all admin calls do.
- No cost that can run away: the app calls no Vercel or Neon API. Reads are SQL on small tables, capped
  at 200 groups and 750 series points, and the answer is kept 60 seconds in the function's memory per
  set of parameters. The write is one statement per request; `METRICS_DISABLED=1` stops it.
- The daily route accepts only the OIDC identity of its own workflow file, and deletes only metric rows.

## 6. Alerts (three kinds, Telegram)

Worked out by the daily step and also by a run every 6 hours of the same workflow (alerts only; the
rollup part does nothing when there is nothing to do). Sent with `scripts/notify-telegram.mjs`, new kind
`metrics` (headline "📈 Metrics alert"), the existing secrets `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
The app itself still sends nothing (`docs/operations/telegram.md`).

| Kind | Fires when | Why this one |
|---|---|---|
| A1 errors | in the last 6 hours, 5xx are at least 2 % of requests and at least 10 requests are 5xx | users see failures; the smoke test only checks at deploy time |
| A2 slow | in the last 24 hours, p95 of all API routes is over 1 000 ms with at least 200 samples | the owner asked about p95; today's requests take 4 to 100 ms (checked in the logs), so 1 s means something is wrong |
| A3 capacity | the database is over 700 MB (70 % of the free 1 GB), or more than 100 answers were 429 in the last 24 hours | the free Neon limit blocks writes when full; many 429s mean the rate limit hurts real users |

- An alert is sent when it starts and again only after it has been clear for 24 hours
  (`metrics_alert_state`). One line per alert: the kind, the value, the limit, a link to `/admin/metrics`.
- No alert for a single slow request, for cold starts, or for the `pg` SSL warning.

## 7. Tasks

Every task: executor Haiku 5.5 (Sonnet for a step Haiku fails twice), Opus judges the PR before merge,
Codex optional (#154). Rules: the Rules section of #275. Each PR keeps
`docs/architecture/capabilities.md` true. "Depends on" lists issues that must be closed first.
All seven issues carry the label `held`, so the dispatcher does not start them before the owner has talked
about this plan (#331). Removing `held` starts them in the order of the table.

| Task | Issue | What | Validator | Size | Depends on | PR body line |
|---|---|---|---|---|---|---|
| O1 | #332 | Migration `010_metrics.sql` (four tables) and `server/metrics/histogram.js` (bucket of a value, merge, percentile with the minimum samples), unit tests. Not wired | Opus (SQL) | S | none | `Implements #331 Task 1` |
| O2 | #333 | Record each request in `measured()` with `waitUntil`, one upsert; caller kind; tool error flag; `METRICS_DISABLED`; tests (one request adds one, a failed write keeps the answer, no real path stored, query budget unchanged) | Opus (SQL, hot path) | M | O1 | `Implements #331 Task 2` |
| O3 | #334 | Client app family for MCP calls: the token check also returns the client's host, mapped to a fixed list (`claude`, `chatgpt`, `grok`, `cli`, `other`) | Opus (auth statement) | S | O2 | `Implements #331 Task 3` |
| O4 | #335 | `GET /api/admin/metrics`, `GET /api/admin/metrics/series`, tools `admin_metrics` and `admin_metrics_series`, per-route binding, 60 s cache, caps, OpenAPI, capabilities rows (UI `no: planned in #331 Task 6` until O6), `docs/operations/admin.md` | Opus (admin, auth) | M | O2 | `Implements #331 Task 4` |
| O5 | #336 | `POST /api/ops/metrics-daily` (CI OIDC of its own workflow only), `metrics-daily.yml` (daily and every 6 hours, plus manual run), product snapshot, hourly to daily merge, retention, Infrastructure row in capabilities | Opus (OIDC, deletion) | M | O1 | `Implements #331 Task 5` |
| O6 | #337 | Admin page `/admin/metrics`: tables, inline SVG chart, product table, link to delivery speed; capabilities UI cells | Opus (design) | M | O4, #285 | `Implements #331 Task 6` |
| O7 | #338 | Alerts A1 to A3 in the daily step, `metrics_alert_state`, Telegram kind `metrics`, `docs/operations/telegram.md` | Sonnet | S | O5 | `Implements #331 Task 7` |

Not a task (decided by Opus, 2026-11-21):

- **The `pg` SSL warning** (264 times in 14 days, checked): it makes "runtime errors" look busy, but the
  fix touches how the app connects to the database. The warning itself says the behaviour today is
  `verify-full`, which is the safe one. It is filtered out of A1 because A1 counts 5xx answers, not log
  lines. Left for the weekly review (#294, #295) to pick up when `pg` 9 comes.
- **`pg_stat_statements`** (slow queries): installing an extension is a production database change and
  the `[perf]` DB time per route already shows a slow route. Not now.
- **Copying Vercel runtime errors into the app**: needs a Vercel token (owner, secret). The 7-day view is
  free with the Vercel MCP tool by hand.

## 8. Questions for the owner

Posted on epic #273. Each one can be answered alone. Nothing else in this plan needs the owner.

- **Q1 (money): pay Vercel for its own metrics?** Decided now: the app keeps its own numbers for free.
  (a) Stay on Hobby: $0, tasks O1 to O7 give p50 to p99.9 from our own data. (b) Vercel Pro plus the
  Observability Plus add-on: Vercel's own percentiles, 1 day of logs or more; price not checked; O2 would
  still be needed for per-tool numbers. Recommendation (a). Default if no answer: (a).
- **Q2 (product behaviour): run the metrics workflow on a schedule?** (a) Daily rollup plus an alert check
  every 6 hours: active users per day are kept and alerts arrive within 6 hours. (b) Manual runs only:
  no alerts, and a day without a run has no active-user number. Recommendation (a). Default if no
  answer: (a), because #331 asks for alerts. (The earlier "on demand first" default was for the weekly
  improvement review only.)
- **Q3 (money, privacy): turn on Vercel Web Analytics for page views and page speed?** (a) No: no
  browser numbers. (b) Yes: page views per page and country; adds a script to every page; free limits
  not checked. Recommendation (a) for now. Default: (a).
- **Q4 (secret): give the app a Neon API key to show CU-hours used?** (a) No: database size comes from
  SQL, CU-hours are read by hand (about 9 of 100 used this month on 2026-11-21). (b) Yes: one more secret
  in Vercel; the page shows CU-hours. Recommendation (a). Default: (a).
