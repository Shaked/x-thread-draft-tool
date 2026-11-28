# Speed plan: from push to production in 2 to 3 minutes

Task #306 (epic #273), Step 1. Planner: Opus. Measured 2026-11-20 between 20:35 and 20:50 UTC.
Owner request (Shaked, 2026-11-20): an average from feature to deployment of 2 to 3 minutes, waiting
time not counted; simple, deterministic, free metrics; a weekly check.

Short answer: the running time is already about 2.4 minutes at the median. What makes it feel slow is
(1) waiting between "CI green" and "merge" (an agent or a person), which the target does not count,
and (2) one CI step that sometimes takes 2 to 6 minutes: the e2e job installs Linux font packages
from a slow Ubuntu mirror on every run. Fixing that step and splitting the unit test job brings the
90th percentile under 2.5 minutes.

## 1. Definitions

- **Feature to deployment**: from the last push of a PR to the end of the production smoke test run
  for its merge commit. Four stages:
  - **(a) CI**: for the PR's last head commit, take the first run of each required workflow (`Tests`,
    `Security`, `CodeQL`, `Net lines`); (a) is from the earliest `run_started_at` to the latest
    completion of those runs (latest attempt). Later runs for the same commit, such as `Net lines`
    after a PR body edit, are waiting, not CI. (`Codex gate` is optional since #154; `Neon preview
    cleanup` takes 17 s and runs alongside.)
  - **(b) Merge**: from the end of (a) to `merged_at`. This is all waiting (Opus review, the agent's
    turn, or a person). Its running time counts as 0 s.
  - **(c) Vercel**: from `merged_at` to the deployment's `success` status (the `deployment_status`
    event that starts `Smoke test (deployed)`). Includes Vercel's own queue, build and upload.
  - **(d) Smoke**: the `Smoke test (deployed)` run for the merge commit, from `run_started_at` of its
    latest attempt to completed. Time before that (a re-run waiting to start) is queue time.
- **Docs-only change**: every changed file matches the `SKIP` list in `scripts/vercel-ignore.mjs`.
  Vercel cancels the build, so stages (c) and (d) do not exist; the total is (a).
- **Running time**: the time a job really runs (`started_at` to `completed_at`).
  **Queue time**: waiting for a runner (`created_at` to `started_at`), for another check, for a
  review or for a person. Queue time is reported on its own and is not part of the target.
- **Median and p90**: over the last N merged PRs (N = 50 here). p90 is nearest-rank: sort the n
  values and take the one at position ceil(0.9 × n) (1-based). For n = 9 that is the largest value.

### Targets (running time, product code change)

| Stage | Median target | p90 limit | Today median | Today p90 |
|---|---|---|---|---|
| (a) CI | 75 s | 90 s | 98 s | 169 s |
| (b) Merge | 0 s (waiting only) | reported, no limit | 109 s wait | 316 s wait |
| (c) Vercel | 25 s | 35 s | 22 s | 27 s |
| (d) Smoke | 15 s | 25 s | 23 s | 29 s |
| **Total** | **120 s** | **150 s** | **144 s** | **218 s** |

Docs-only change: the total is (a), median target 75 s, p90 limit 90 s (today 84 s and 99 s).
The owner's 2 to 3 minute goal is 120 to 180 s; the p90 limit of 150 s keeps a margin below 3 minutes.

## 2. Baseline (real data, last 50 merged PRs: #168 to #303, 2026-11-19 04:53 to 2026-11-20 19:22 UTC)

Sources, all read on 2026-11-20 with the GitHub MCP tools and the Vercel MCP tools, no new service:
Actions runs of `tests.yml`, `security.yml`, `codeql.yml`, `net-lines.yml`, `neon-preview-cleanup.yml`,
`codex-gate.yml`, `smoke-deployed.yml` (100 newest each), job and step timings for 6 runs, 2 job logs,
the 60 newest closed PRs, `git log` merge commits (head sha = second parent), and 100 Vercel
production deployments (team `shaked-klein-orbachs-projects`, project `x-thread-draft-tool`) plus one
deployment's build events.

41 PRs changed product code, 9 were docs-only.

| Stage (seconds) | Product code median | p90 | max | Docs-only median | p90 |
|---|---|---|---|---|---|
| (a) CI, all required runs | 98 | 169 | 450 | 84 | 99 |
| `Tests` run alone | 98 | 169 | 450 | 84 | 99 |
| `CodeQL` run (35 PRs had it) | 68 | 79 | 88 | 65 | 85 |
| `Security` run | 20 | 24 | 29 | 19 | 21 |
| `Net lines` run | 10 | 20 | 22 | 8 | 17 |
| (b) Merge wait (queue) | 109 | 316 | 8906 | 120 | 23355 |
| (c) Vercel: merge to deployment created | 3 | 4 | 15 | 3 | 4 |
| (c) Vercel: merge to `success` | 22 | 27 | 32 | n/a | n/a |
| (d) Smoke run | 23 | 29 | 35 | n/a | n/a |
| **Running total (a)+(c)+(d)** | **144** | **218** | 497 | **84** | **99** |
| Wall clock incl. waiting | 254 | 512 | 9059 | 203 | 23451 |

Queue time for a GitHub runner: 2 s in every one of the 6 sampled `Tests` runs and the sampled smoke
run (job `created_at` to `started_at`). It is not a problem. The waiting is all in (b), plus one
smoke re-run: #246's smoke run is attempt 2, created 22:53:18, started 22:57:47 (269 s queue), ran 21 s.
The docs-only p90 of (b) and of the wall clock is one PR (#267) that waited 6.5 hours for a person.

### Where the time goes: the `Tests` run of #303 (a normal run, 97 s)

| Job | Total | Main steps |
|---|---|---|
| Unit tests (vitest) | 93 s | unit and API tests (`test:budget`) 67 s; setup-node 6 s; `npm ci` 5 s; lint 5 s; build 3 s; knip, slop, jscpd, migration lint 2 s |
| E2E tests (playwright) | 67 s | run e2e 39 s (60 tests, 1 worker); install browsers 9 s; `npm ci` 6 s; setup-node 5 s; cache restore 3 s |
| Smoke test against the local API | 18 s | `npm ci` 5 s; setup-node 5 s; start API 3 s; smoke 1 s |

The unit job is the critical path in a normal run: 67 s of its 93 s is the test run.
`test:budget` CI line for #303: `total 67100 ms over 97 files`, `workers 3 (cpus 4)`; vitest:
`import 29.56s, tests 115.83s, environment 19.12s` (summed over workers).

### Where the p90 comes from: the e2e browser step

7 of the 50 PRs had a `Tests` run over 120 s (#268 182 s, #262 318 s, #224 163 s, #218 169 s,
#216 450 s, #215 161 s, #214 180 s). In the three runs sampled, the step "Install Playwright
browsers" took 6 min 35 s (#216), 3 min 50 s (#262) and 2 min 4 s (#268), against 9 s in #303.
The job log of #216 shows why: the browser cache hit (292 MB in 2 s), but `--with-deps` runs
`apt-get update` (18 s) and then downloads 9 font packages that the runner image does not have
(`fonts-ipafont-gothic`, `fonts-freefont-ttf`, `fonts-unifont`, `fonts-wqy-zenhei`, `xfonts-*`):
`Fetched 21.9 MB in 5min 58s (61.1 kB/s)` from `us-east-2.ec2.archive.ubuntu.com`. Every library
Chromium needs was "already the newest version". The same step runs in `ui-image-upload.yml` and
on every push to `main` (`Tests` on `main`, last 50 runs: median 90 s, p90 254 s, max 646 s).

### Slowest unit and API test files (local run, 4 CPUs, 3 workers, 2026-11-20)

Whole suite: 45.4 s wall locally (67.1 s in CI). 97 files; API files take 67.0 s of the 74.9 s summed
file time, unit files 7.9 s. Every API file loads the migrated PGlite snapshot once (`tests/api/helpers/db.js`).

| ms | File | ms | File |
|---|---|---|---|
| 3262 | tests/api/oauth-migration.test.js | 1828 | tests/api/mcp-contract.test.js |
| 3081 | tests/api/migrate.test.js | 1792 | tests/api/mcp-prompts.test.js |
| 2298 | tests/api/mcp.test.js | 1683 | tests/api/mcp-ui.test.js |
| 2263 | tests/api/oauth.test.js | 1608 | tests/api/admin-guard.test.js |
| 2183 | tests/api/suspension.test.js | 1594 | tests/api/drafts.test.js |
| 2126 | tests/api/mcp-skills.test.js | 1578 | tests/api/admin-schema.test.js |
| 2074 | tests/api/admin-read.test.js | 1545 | tests/api/mcp-clients.test.js |
| 1906 | tests/api/admin-delete.test.js | 1519 | tests/api/changelog.test.js |
| 1865 | tests/api/tokens.test.js | 1506 | tests/api/share.test.js |
| 1855 | tests/api/admin-mcp.test.js | 1494 | tests/api/oauth-tokens.test.js |

No single file is the problem: all are under their budget (5 s, 7 s for the two migration files).
The run is long because there are 53 API files of 1.5 to 3 s each on 3 workers.

Slowest e2e tests: **not checked**. The local Playwright browser does not match the project's
version, so the local run failed at launch; the CI total is 30 to 39 s for 60 tests on 1 worker.
Task S3 records the per-test times from the CI report before it changes anything.

### Vercel (one build read in full: merge of #304, `dpl_CxADWuBAQex3cCsWzGemrykzqhQj`)

Queued 1.1 s, clone 0.7 s, ignore step 0.3 s, `npm install` 1.6 s (build cache restored),
migrations 0.2 s, `vite build` 0.4 s plus PWA 2 s, "Build Completed [7s]", upload 4.4 s:
ready 13.1 s after created. Building the build cache (15 s) happens after the deployment is ready.
Build machine: 2 cores, 8 GB. Nothing here is worth changing. Docs-only merges show `CANCELED`
deployments, as `vercel-ignore` intends.

### Not used or not checked

- `[perf]` log lines: they time API requests in production, not delivery. Not used.
- Which checks branch protection requires: **not checked** (no tool here reads branch protection).
  Task S2 keeps every existing check name reporting, so it does not matter.
- Per-test e2e times: not checked (see above).
- The pre-commit hook (lint, build, all unit tests; about 55 s locally) runs before the push, so it is
  outside the definition. Measured only once, locally.

All 50 PRs (seconds; "-" = no deployment):

| PR | Kind | (a) CI | Tests run | CodeQL | Merge wait | (c) Vercel | (d) Smoke | Running total |
|---|---|---|---|---|---|---|---|---|
| #303 | code | 97 | 97 | 79 | 122 | 21 | 21 | 139 |
| #302 | code | 98 | 98 | 74 | 8906 | 22 | 33 | 153 |
| #300 | code | 99 | 99 | 69 | 457 | 23 | 22 | 144 |
| #296 | docs | 98 | 98 | 62 | 16 | - | - | 98 |
| #272 | code | 100 | 100 | 66 | 110 | 31 | 24 | 155 |
| #267 | docs | 96 | 96 | 85 | 23355 | - | - | 96 |
| #270 | docs | 90 | 90 | 65 | 120 | - | - | 90 |
| #268 | code | 182 | 182 | 73 | 33 | 21 | 24 | 227 |
| #264 | code | 94 | 94 | 66 | 17 | 20 | 21 | 135 |
| #263 | docs | 79 | 79 | 55 | 124 | - | - | 79 |
| #262 | code | 318 | 318 | 67 | 68 | 32 | 27 | 377 |
| #261 | code | 78 | 78 | 58 | 127 | 23 | 22 | 123 |
| #259 | docs | 80 | 80 | 71 | 25 | - | - | 80 |
| #260 | code | 119 | 119 | 74 | 87 | 18 | 19 | 156 |
| #254 | code | 80 | 80 | 51 | 8 | 21 | 21 | 122 |
| #253 | code | 98 | 98 | 75 | 110 | 20 | 22 | 140 |
| #251 | code | 112 | 112 | 63 | 24 | 20 | 28 | 160 |
| #252 | code | 79 | 79 | 72 | 31 | 20 | 27 | 126 |
| #234 | docs | 78 | 78 | 69 | 194 | - | - | 78 |
| #249 | code | 70 | 70 | 57 | 107 | 21 | 22 | 113 |
| #248 | code | 95 | 95 | 68 | 111 | 22 | 19 | 136 |
| #247 | code | 90 | 90 | 77 | 117 | 20 | 21 | 131 |
| #246 | code | 97 | 97 | 69 | 104 | 21 | 21 | 139 |
| #245 | code | 101 | 101 | 55 | 342 | 19 | 29 | 149 |
| #240 | code | 80 | 80 | 68 | 130 | 21 | 23 | 124 |
| #239 | code | 98 | 98 | 67 | 61 | 23 | 24 | 145 |
| #236 | docs | 99 | 99 | 54 | 95 | - | - | 99 |
| #235 | code | 97 | 97 | 64 | 16 | 24 | 18 | 139 |
| #232 | code | 88 | 71 | 88 | 116 | 22 | 22 | 132 |
| #231 | code | 100 | 100 | 68 | 109 | 22 | 22 | 144 |
| #230 | code | 84 | 84 | 79 | 145 | 21 | 20 | 125 |
| #228 | code | 83 | 83 | 80 | 316 | 24 | 28 | 135 |
| #227 | code | 99 | 99 | 63 | 141 | 22 | 35 | 156 |
| #226 | code | 98 | 98 | 71 | 117 | 23 | 22 | 143 |
| #225 | code | 117 | 117 | 70 | 181 | 24 | 22 | 163 |
| #224 | code | 163 | 163 | - | 51 | 27 | 33 | 223 |
| #223 | code | 96 | 96 | - | 8510 | 26 | 25 | 147 |
| #222 | code | 77 | 77 | - | 132 | 28 | 26 | 131 |
| #221 | code | 94 | 94 | - | 67 | 23 | 32 | 149 |
| #220 | code | 110 | 110 | - | 130 | 21 | 27 | 158 |
| #219 | code | 113 | 113 | - | 57 | 21 | 26 | 160 |
| #218 | code | 169 | 169 | - | 38 | 26 | 23 | 218 |
| #217 | code | 91 | 91 | - | 68 | 21 | 19 | 131 |
| #216 | code | 450 | 450 | - | 117 | 21 | 26 | 497 |
| #215 | code | 161 | 161 | - | 44 | 27 | 28 | 216 |
| #214 | code | 180 | 180 | - | 35 | 21 | 17 | 218 |
| #213 | docs | 84 | 84 | - | 122 | - | - | 84 |
| #211 | code | 85 | 85 | - | 28 | 26 | 20 | 131 |
| #209 | docs | 71 | 71 | - | 28 | - | - | 71 |
| #168 | code | 72 | 72 | - | 7 | 23 | 25 | 120 |

CodeQL "-": CodeQL did not run on PRs then.

## 3. Findings and fixes

Saving = expected change of the running time; "p90" means it mostly removes slow outliers.

| # | Finding | Fix | Expected saving | Task |
|---|---|---|---|---|
| F1 | `npx playwright install --with-deps chromium` re-installs 9 font packages from apt on every e2e run; 2 to 6.5 min on slow mirror days | Install the browser without `--with-deps` in `e2e` and `ui-image-upload.yml` (every library Chromium needs is already on the image); key the browser cache on the Playwright version. The manual `screens` job keeps `--with-deps`. If a layout test changes, install only the needed fonts; never loosen an assertion | p90 of (a): 169 s to about 100 s; normal runs about 6 s | S1 |
| F2 | The unit job runs build, lint, knip, slop, jscpd and migration lint, then 67 s of tests, all in one job | Split: a `checks` job (build and static checks) and the tests in 2 shards (`vitest --shard`), plus a final job named `Unit tests (vitest)` with `if: always()` that fails unless every needed job succeeded (a skipped check counts as passing, so it must never be skipped) | Unit path 93 s to about 55 s; (a) median about 98 s to 75 s (then CodeQL, about 70 s, is the longest run) | S2 |
| F3 | E2E runs with 1 worker in CI (`workers: process.env.CI ? 1 : undefined`) on a 4-CPU runner | 2 workers in CI, only if 5 runs in a row have no flaky retry | e2e test step 39 s to about 22 s | S3 |
| F4 | `Smoke test (deployed)` runs `npm ci` (6 s) and the npm cache restore, but `scripts/smoke.mjs` and everything it imports use only `node:` modules and repository files (checked: it loads with no `node_modules`); so does `scripts/notify-telegram.mjs` | Remove `npm ci` and the npm cache from that job; a unit test follows the imports of both scripts and fails on any package import | (d) 23 s to about 15 s | S4 |
| F5 | No repeatable measurement exists; this plan was measured by hand | `scripts/speed-metrics.mjs` and a workflow (section 4) | none directly; it shows the next slowdown | S5 |
| F6 | Nothing warns when a stage gets slower | Per-merge speed budget check, warn first, then fail (section 5) | none directly | S5, S6 |
| F7 | No weekly view | Speed signal in the weekly review (section 6) | none directly | S7 |

Looked at and decided, no task (Opus, 2026-11-20):

- **Path filters for docs-only PRs**: no. Tests read docs (for example
  `tests/api/surface-alignment.test.js` parses `docs/architecture/capabilities.md`, and the build reads
  `docs/changelogs/`), so a docs change can break a test. Docs-only CI is already 84 s median.
- **Caching `node_modules`**: no. `npm ci` takes 5 to 6 s with the npm cache; a `node_modules` cache
  restore costs about the same.
- **Duplicate build** (unit job and e2e web server each run `vite build`, 3 s each): parallel, not on
  the critical path. No change.
- **`Tests` on every push to `main`**: kept. It checks the real merge result; it is not on the path to
  production (Vercel deploys from the push in parallel). F1 makes it faster too.
- **CodeQL** (68 s median, runs in parallel): kept as is. After F2 it is the longest required run;
  cutting its query set would weaken a security check.
- **Codex review wait**: already optional (#154, 2026-11-19); it is part of (b), not of the target.
- **Fixed waits**: the only `sleep`s in workflows are 1 s loops that wait for the local servers to
  start (the local smoke job, 3 s in practice, and the manual `screens` job). No fixed waits in the smoke or deploy path. `waitForTimeout(300)` exists only
  in `screens.spec.ts`, which is not part of the default run.
- **Screenshots**: in the default e2e run only 2 specs write screenshot files (`mcp-thread-view`,
  `signed-out-editor`, light and dark); they are files for people, not comparisons. Not worth chasing.
- **Vercel build and `vercel-ignore`**: 13 s from created to ready, 3 s from merge to created,
  docs-only builds cancelled. Nothing to change.
- **Bundle size**: `EmojiPicker` chunk is 506 kB (Vite warns). It does not slow the build (0.4 s); it is
  a page-load question, not a delivery one. Out of scope.
- **Local smoke and deployed smoke**: both kept. The local one (18 s, parallel, before merge) tests
  the code; the deployed one tests the real deployment (OIDC sign-in, Neon, Blob). Different checks.
- **Pre-commit hook**: kept. It is before the push, outside the definition, and it is the local guard
  the agents rely on.
- **Node 20 download**: `setup-node` downloads Node 20 on each job (about 3 s) because the runner image
  does not carry it. Changing the Node version is the weekly review's job (#295 tracks `node-version`).

Never weaken, skip or disable a test for speed. Every fix above runs the same tests, only in parallel,
cached or with cheaper setup.

### Update 2026-11-28 (#576): E2E in four shards, UI audit in two files

The speed gate opened on 2026-11-27 16:16 UTC: the stage "CI checks" (stage (a), the first run of each required workflow on the PR head) was 1 min 48 s against 1 min 30 s. The `Checks (build, lint, knip, ...)` job is not the cause: it takes 25 to 32 s. The longest job was E2E shard 3/3 ("Run E2E tests" 57 s before, 69 s after), because `--shard` cuts the tests by count in file order, and the slow `ui-audit.spec.ts` tests fell into shards 2 to 4 (shard 1 held none).

Change (PR 631): `e2e-shard` runs 4 shards (`--shard=n/4`), and the UI audit is registered from two spec files (`audit-early.spec.ts` sorts early, `ui-audit.spec.ts` late; shared code in `ui-audit-cases.ts`; same 165 tests, same assertions and screenshots) so each shard gets a share of the slow tests. Measured locally (4 CPUs, 3 workers, each shard with its own build and servers): 34, 35, 32 and 41 s. A split at 16 pages instead of 13 measured 35, 44, 30 and 45 s, so 13 is kept.

What this does not fix: the stage is the latest end of `Tests`, `Security`, `CodeQL` and `Net lines`. The unit shards (up to about 75 s wall) and CodeQL (58 to 95 s on first attempts) are now as long as the E2E shards, so the margin under 90 s is thin. CI runs `retries: 2` for Playwright, so one flaky test can stretch a shard by a retry. A follow-up, if the gate stays open: balance the unit shards further (`npm run shard-timings`), and measure what in CodeQL is slow. CodeQL is not weakened and no limit changes.

## 4. Metrics solution

`scripts/speed-metrics.mjs` (task S5). No model, no new paid service, no new secret.

- **Inputs**, through injected fetchers so tests run offline:
  - GitHub REST with the workflow's `GITHUB_TOKEN`: merged PRs (`/pulls?state=closed`), workflow
    runs per head sha (`/actions/runs?head_sha=`), jobs per run (`/actions/runs/{id}/jobs`), and the
    deployments and statuses of the merge commit (`/deployments?sha=`, `/deployments/{id}/statuses`).
  - **Vercel times come from the GitHub Deployments API.** Vercel writes a GitHub deployment and its
    statuses for every build; that is what starts `Smoke test (deployed)` today. This avoids a Vercel
    token (a new secret). Decided by Opus, 2026-11-20.
  - Changed files of the merge commit (`/commits/{sha}`), classified with `shouldSkip` imported from
    `scripts/vercel-ignore.mjs` (one function, no copy), called as
    `shouldSkip({ VERCEL_ENV: 'production' }, files)` because it returns false for any other env.
- **Output**: `speed.json` (per PR: the four stages, running and queue time, kind; summary: median and
  p90 per stage and kind; the limits; `over` flags) and `speed.md` (the same as a markdown table, plus
  the change against the previous run: `+12 s` / `-30 s` per stage). Keys sorted, numbers rounded to
  whole seconds, PRs sorted by number, so the same input gives byte-identical output.
- **Modes**: `--last 50` (on demand), `--since 7d` (weekly: every merge of the last 7 days; about 25
  merges a day means `--last 50` is only 2 days) and `--merge <sha>` (one merge, section 5).
  `--previous <file>` adds the trend. Stage times use the first run per workflow and the latest
  attempt's `run_started_at`, as in section 1; p90 is nearest-rank as in section 1.
- **Where it is kept**: an Actions artifact `speed-metrics` (90 days) and the job summary. No file under
  `docs/metrics/`. The weekly run (section 6) reads the previous week's artifact for the trend.
- **Telegram**: one line, only when a stage's p90 is over its limit in `--last` mode, using a new kind
  `speed` in `scripts/notify-telegram.mjs` (existing secrets `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`).
- **Workflow** `.github/workflows/speed-metrics.yml`: `workflow_dispatch` (input `last`, default 50)
  and `workflow_run` of `Smoke test (deployed)` for the per-merge check, running only when that run
  was for the `Production` environment (read from the run's deployment through the API) and its
  conclusion is not `cancelled`. Permissions:
  `contents: read`, `actions: read`, `pull-requests: read`, `deployments: read`, and nothing with
  `write` (a test asserts it). Checks out the default branch only, `persist-credentials: false`. Commit titles and PR titles never enter shell text.
- **Tests**: `tests/unit/speed-metrics.test.js` with a saved sample (a trimmed copy of real API
  responses for about 5 PRs, with logins and emails removed) under `tests/unit/fixtures/speed/`:
  stage math, median and p90, docs-only classification, negative merge wait clamped to 0 and flagged,
  missing smoke run, a re-run (`run_attempt` 2), byte-identical output for the same input, and the
  trend lines. `tests/unit/speed-metrics-workflow.test.js` checks the triggers and the permissions.

## 5. Speed budget check in CI

- After every production smoke run, `speed-metrics.yml` runs `--merge <sha>` for that merge commit
  and compares each stage with the p90 limits of section 1.
- **Warn first** (task S5): a `::warning::` line per stage over its limit and a job summary table.
  The run stays green. No Telegram for single merges (one slow merge is noise).
- **Fail later** (task S6): once tasks S1 to S4 are merged and the last 20 merges are all within the
  limits, S6 makes the per-merge check fail (red run) when a stage is over its limit for 3 merges in a
  row, and sends the Telegram `speed` line. "3 in a row" is computed from the API for the last 3
  production merges each time; no state is stored. It never blocks a merge or a deployment: it runs after them.
- The existing `npm run test:budget` (per file 5 s, total 70 s) stays; S2 sets a per-shard total that is
  lower, never higher.

## 6. Weekly run

Task S7, after #295 (the weekly review workflow) and S5.

- The weekly workflow (`.github/workflows/weekly-review.yml`, #295) runs
  `node scripts/speed-metrics.mjs --since 7d --previous <file>` and uploads its own artifact
  `speed-metrics-weekly`. `--previous` is the `speed-metrics-weekly` artifact of the last successful
  run of that same workflow. If there is none, `slower` is false for every stage.
- The speed signal that goes into the weekly fingerprint is small and stable: for each stage, `over`
  (p90 over its limit: true or false) and `slower` (median at least 20 % and at least 10 s higher than
  last week: true or false). Raw seconds are not in the fingerprint, so a normal week changes nothing.
- An issue is opened only when one of those flags is true and the fingerprint changed (the #295 rule).
  The issue body has the `speed.md` table in a fenced block. No model is called when nothing changed.

## 7. Task list

All tasks: executor Haiku 5.5 (Sonnet for a step Haiku fails twice), validator Opus, Opus judges the
PR. Each PR reports the measured before and after for its stage from the Actions API (and, after S5,
from `speed-metrics`). None of them is a product capability, so `docs/architecture/capabilities.md`
does not change. Rules: the Rules section of #275.

| Task | Issue | What | Complexity | Expected saving | Depends on | PR body line |
|---|---|---|---|---|---|---|
| S1 | #309 | E2E browser install without apt fonts; cache key on the Playwright version (`tests.yml` e2e job, `ui-image-upload.yml`) | S | p90 (a) about -70 s | none | `Implements #306 Task 1` |
| S5 | #310 | `scripts/speed-metrics.mjs`, its tests, `speed-metrics.yml`, warn-only per-merge check, Telegram kind `speed`, `docs/operations/ci-cd.md` section | M | none (measurement) | none | `Implements #306 Task 5` |
| S2 | #312 | Split the unit job: `checks` job, 2 test shards, final `Unit tests (vitest)` job; `test:budget` per-shard total | M | (a) median about -23 s | S1 (#309) | `Implements #306 Task 2` |
| S3 | #313 | E2E with 2 workers in CI, after recording per-test times | S | e2e step about -17 s | S1 | `Implements #306 Task 3` |
| S4 | #311 | Smoke (deployed) without `npm ci`; test that `scripts/smoke.mjs` and `scripts/notify-telegram.mjs` import no package (transitively) | S | (d) about -8 s | none | `Implements #306 Task 4` |
| S6 | #314 | Per-merge budget check from warn to fail (3 merges in a row) | S | none (guard) | S1, S2, S3, S4, S5 | `Implements #306 Task 6` |
| S7 | #315 | Speed signal in the weekly review | S | none (weekly view) | #295, S5 | `Implements #306 Task 7` |

Expected result after S1 to S4: (a) about 70 s median and 85 s p90 (CodeQL becomes the longest run),
(c) unchanged at about 22 s and 27 s, (d) about 15 s and 22 s. Total about 107 s median and 134 s p90.
