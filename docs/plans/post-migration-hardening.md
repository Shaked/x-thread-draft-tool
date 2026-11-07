# Plan: Keyless agent auth, automated reviews, code quality gates, light UI

Status: **Planned, decisions complete (2026-11-07). Not started.** Task 1.0 is in PR #24.
Owner: Shaked (decisions, dashboard steps, merges). Executor: an agent following
[How to execute this plan](#how-to-execute-this-plan) one task at a time.

## Goal

1. **No long-lived secrets for GitHub or agents.** CI uses GitHub OIDC. Agents connect like any
   other connector: add the URL once, approve once, then 1-hour access tokens refresh automatically.
2. **Security and code review run on every pull request** and block merges on high or critical findings.
3. **Code stays small and clean**: lint, dead code, duplicate code, slop, and a net-lines rule.
4. **Tests stay fast**: each test file ≤ 3 s, the unit + API suite ≤ 30 s.
5. **A light, friendlier UI**: light theme by default (Light / Dark / System setting), plainer
   wording, clearer screens, phone first.

## Decisions (all answered by Shaked, 2026-11-07)

| # | Question | Answer |
|---|---|---|
| D1 | Automated review blocks or comments | **Blocks on high/critical.** Codex `P0`/`P1` findings block; `P2`/`P3` only comment. |
| D2 | Fix `npm audit` findings first | **Yes, Task 0.** Gates start green, no allowlist. |
| D3 | Agent auth | **Remote MCP connector in this Vercel project** (`/api/mcp`), OAuth 2.1 with GitHub sign-in, 1-hour access tokens, rotating refresh tokens. Device flow kept for scripts, issuing the same short-lived pair. |
| D4 | Hand-made `xt_` tokens | **Kept, maximum 7 days** (today: up to 365). |
| D5 | Theme | **Light by default, plus a Light / Dark / System setting** stored per browser. |
| D6 | Blocking reviewer | **Codex** (its GitHub App already reviews PRs, no repo secret). A workflow turns its findings into a required check. |

## Baseline (measured 2026-11-07 on `main` @ 2e492a4)

| Item | Measured | Target |
|---|---|---|
| `npm audit` | 39: 3 critical, 20 high, 13 moderate, 3 low | 0 high or critical; react-router moderate fixed too |
| Critical findings | All dev-only: `vitest`, `@vitest/ui`, `tinypool` | — |
| Production high findings | 4, one chain: `@vercel/blob` → `@vercel/oidc` → `@vercel/cli-config` → `zod <4.6.6` | 0 |
| Production moderate | `react-router-dom` 6.30.3 open redirect (fixed in 7.x) | 0 |
| Suite time in CI | 18.8 s (14 files, 152 tests) | ≤ 30 s |
| Per-file time in CI | 10 of 14 files over 3 s (3.3–4.7 s), all PGlite-backed API files | each ≤ 3 s |
| CI duplicate work | `tests.yml` runs the API tests twice (`test:unit` includes `tests/api`) | once |
| Linter | None (`npm run lint` is `vite build`) | ESLint |
| Deployed smoke test | Red on every deployment since the migration merge | Fixed in PR #24 (Task 1.0) |
| GitHub secrets | `XT_SMOKE_TOKEN`, `XT_SMOKE_TOKEN_PRODUCTION`, `VERCEL_AUTOMATION_BYPASS_SECRET`, `DATABASE_URL_UNPOOLED`, `BLOB_READ_WRITE_TOKEN`, `SUPABASE_*`, `BACKUP_PASSPHRASE` | none long-lived |
| Agent credential | `xt_` token, 90 days default, up to 365 | 1 h access token + rotating refresh |
| UI | Dark only. `App.css` 1,789 lines, 209 hard-coded colors, 0 CSS variables | Tokens, light default |

Versions at planning time (check again with `npm view <pkg> version` before Task 0):
vitest 2.1.9 → 5.1.0, vite 5.4.21 → 8.3.6, vite-plugin-pwa 0.17.5 → 2.0.0 (peer: vite ≤ 8),
react-router-dom 6.30.3 → 7.18.5, `@vercel/blob` 2.8.2 is already latest and still depends on
`@vercel/oidc ^3.6.1`, zod fixed in 4.6.6.

---

## How to execute this plan

Read this section before every task. It applies to every task below.

### Rules
1. **One task (or one numbered sub-task when the task says so) per pull request.** Never start a
   task Shaked has not named. "Go" applies to the last task you asked about.
2. Follow [`.claude/skills/agent-pr-workflow.md`](../../.claude/skills/agent-pr-workflow.md) and use
   `scripts/agent-pr.sh` for branches, pushes, PRs and CI reading (lands with PR #25).
3. Start from the latest `main`: `scripts/agent-pr.sh branch claude/<task-slug>`.
4. Before every commit: `npm run build` and `npm run test:unit` pass (the pre-commit hook runs
   them). Do not use `--no-verify`.
5. Every PR adds one changelog file `docs/changelogs/YYYYMMDD-HHMMSS-<slug>.md` (UTC) and updates
   the task's **Status** line in this file to `In PR #NN`. Shaked marks it `Done` after merge.
6. Never merge, never approve, never run anything against production
   (`https://x-thread-draft-tool.vercel.app`) without Shaked asking in chat.
7. Never print, paste or commit secrets. Ask Shaked to add secrets in GitHub or Vercel settings.
8. No model names in commits or PR text.
9. Pin every third-party GitHub Action to a full commit SHA with the version in a comment
   (`uses: actions/checkout@<sha> # v4.2.2`). Get the SHA with
   `gh api repos/<owner>/<repo>/git/ref/tags/<tag> --jq .object.sha` (dereference annotated tags).
   Every workflow sets top-level `permissions: contents: read` and widens per job only as needed.
   `actions/checkout` uses `persist-credentials: false` unless the job pushes.
10. **Stop and ask Shaked** (one message, then wait) when: a step's command fails twice for the same
    reason; a dependency upgrade needs code changes outside the files the task lists; a task needs
    a secret, a dashboard setting or a production action; or the acceptance check cannot pass.

### Task template
Each task lists: **Why**, **Files**, **Steps**, **Tests**, **Acceptance** (commands and the
exact expected result), **Stop if**. Do the steps in order. A task is done only when every
acceptance line is met; paste the acceptance results into the PR description.

---

## Task 0 — Clear the audit findings

Status: 0.1 In PR #26. Four PRs, in order: 0.1, 0.3a, 0.2, 0.3b.

### 0.1 Test tooling major upgrade (fixes all 3 critical)
**Why:** `vitest`, `@vitest/ui`, `tinypool` critical findings.
**Files:** `package.json`, `package-lock.json`, `vitest.config.js`, `tests/**` only if the upgrade breaks an API they use.
**Steps:**
1. `npm install -D vitest@latest @vitest/ui@latest jsdom@latest`
   **Deviation (approved by Shaked, 2026-11-07):** `@latest` fails with ERESOLVE because vitest 5 needs
   vite ≥ 6 and this repo is on vite 5 (upgraded in Task 0.3a). 0.1 therefore pins `vitest` and
   `@vitest/ui` to 3.2.7, `jsdom` to ^29.1.1 (jsdom 31 needs Node 22.22+; CI runs Node 20), and adds
   `"overrides": { "tinypool": "^2.2.0" }` (outside vitest 3's `^1.1.1` range). Task 0.3a removes the override.
2. `npx vitest run`. Fix config deprecations named in the output (read the vitest migration
   guide for each major between 2 and the installed version).
3. Do not change test assertions to make them pass. A behavior change in a test means stop and ask.
**Acceptance:**
- `npm audit --json | node -e "process.stdin.on('data',d=>{const m=JSON.parse(d).metadata.vulnerabilities;console.log(m.critical)})"` prints `0`.
- `npm run test:unit` passes, 152 or more tests.
**Stop if:** more than 5 test files need edits.

### 0.2 Production high chain (`zod` via `@vercel/blob`)
Status: In PR #30.
**Why:** 4 high findings reach production through `@vercel/blob`.
**Files:** `package.json`, `package-lock.json`.
**Steps:**
1. Add to `package.json`: `"overrides": { "zod": "^4.6.6" }`. Run `npm install`.
2. `npm audit --omit=dev`. If high findings remain on `@vercel/oidc` or `@vercel/cli-config`,
   add `"@vercel/oidc": "^4.0.7"` to `overrides`, run `npm install`, check again.
3. `npm ls zod @vercel/oidc` to confirm one resolved version each.
**Tests:** `tests/api/images.test.js` must pass unchanged.
**Acceptance:**
- `npm audit --omit=dev --audit-level=high` exits 0.
- `npm run test:unit` passes.
- After the preview deploys: `scripts/agent-pr.sh smoke` passes, and Shaked confirms one image
  upload in the UI on the PR's preview (ask him; record the answer in the PR).
**Stop if:** the override needs `@vercel/oidc` 4.x and `@vercel/blob` calls fail.

### 0.3a Build tooling and vitest 4 (vite 8 stack)
Status: In PR #29.
**Why:** `vite` 5 blocks vitest ≥ 4.1.11 (critical fix) and `vite-plugin-pwa` 0.17 only accepts vite ≤ 5. Removes the tinypool override from 0.1.
**Files:** `package.json`, `package-lock.json`, `vite.config.js`.
**Steps:**
1. Pin exactly: `vite` 8.3.6, `@vitejs/plugin-react` 6.2.1, `vite-plugin-pwa` 2.0.0, `vitest` 4.1.12,
   `@vitest/ui` 4.1.12. vitest 5 needs Node 22.12+ and CI runs Node 20, so 4.1.12 is the ceiling.
   Remove `overrides.tinypool`. Regenerate the lockfile with `npx -y npm@11 install` (npm 10 can crash
   on fresh resolution).
2. `npm run build`. Fix `vite.config.js` per the vite 8 and vite-plugin-pwa 2 migration guides.
   Keep the PWA manifest values and `registerType` behavior identical.
3. `npm ls vite vitest vite-plugin-pwa` shows one `vite` (8.3.6).
**Tests:** unit and API tests pass unchanged. Fix config only, never assertions.
**Acceptance:**
- `npm audit --audit-level=critical` exits 0. Paste the high list; the zod/`@vercel/blob` chain stays for 0.2.
- `npm run build` passes; `dist/sw.js` exists; diff the manifest and `sw.js` directives against main.
- `npm run test:unit` passes under Node 20 (152 or more). E2E passes in CI.
- `npm ls tinypool` shows no override.
- On the preview: login page loads, a draft opens, and the PWA update behavior from
  `docs/changelogs/20261107-170524-pwa-immediate-update.md` still holds (Shaked checks it and records the answer in the PR).
**Stop if:** vite-plugin-pwa 2.x changes service-worker behavior that changelog relies on.

### 0.3b React Router major
**Why:** the react-router open redirect (moderate).
**Files:** `package.json`, `package-lock.json`, `src/App.jsx` and any file importing `react-router-dom`.
**Steps:**
1. `npm install react-router-dom@latest`. React Router 7 keeps the `react-router-dom` import path;
   follow its v6 → v7 upgrade guide (future flags first, then the version bump).
2. `npm audit --audit-level=moderate`. List any finding that has no fix.
**Acceptance:**
- `npm run build` and `npm run test:unit` pass; E2E passes in CI.
- On the preview: login page loads and a draft opens (Shaked).
**Stop if:** a route changes behavior that the E2E tests do not cover.

---

## Task 1 — CI cleanup

### 1.0 Fix the automatic deployed smoke test
Status: **In PR #24** (green). Production deployments run the full test with
`XT_SMOKE_TOKEN_PRODUCTION`; preview deployments run public steps only (`XT_SMOKE_PUBLIC=1`).
Task 7.1 replaces both tokens with OIDC and restores the full test on previews.

### 1.1 Run the API tests once
Status: In PR #28.
**Files:** `.github/workflows/tests.yml`.
**Steps:** delete the `Run API tests` step (`- name: Run API tests` and `run: npm run test:api`).
**Acceptance:** the `Unit tests (vitest)` job log shows `Test Files  14 passed` once and no second vitest run.

### 1.2 Remove Supabase leftovers
Status: blocked until Shaked confirms the Supabase project is deleted (on or after 2026-11-21).
**Files:** delete `.github/workflows/supabase-backup.yml`, `.github/workflows/data-migrate.yml`,
`scripts/supabase-db-url.sh`, `scripts/migrate-from-supabase.mjs`,
`tests/api/migrate-from-supabase.test.js`; remove their mentions in `docs/`, `README.md`, `SETUP.md`
(`grep -rn -i supabase docs README.md SETUP.md`), leaving historical changelogs unchanged.
**Shaked does:** delete GitHub secrets `SUPABASE_*`, `BACKUP_PASSPHRASE`, `DATABASE_URL_UNPOOLED`,
`BLOB_READ_WRITE_TOKEN`; delete Vercel env vars `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
**Acceptance:** `grep -rn "secrets\.\(SUPABASE\|BACKUP\|DATABASE_URL\|BLOB\)" .github` prints nothing; CI green.

---

## Task 2 — Security gates

Status: Not started. One PR for 2.1–2.3; 2.4 is Shaked's.

### 2.1 CodeQL
**Files:** new `.github/workflows/codeql.yml`.
**Steps:** triggers `push` to `main`, `pull_request`, weekly `schedule`. One job with
`permissions: security-events: write, contents: read`. Steps: checkout,
`github/codeql-action/init` (`languages: javascript-typescript`, `queries: security-extended`),
`github/codeql-action/analyze`.
**Acceptance:** the PR shows a CodeQL check that completes with success.

### 2.2 Dependency review and audit gate
**Files:** new `.github/workflows/security.yml`.
**Steps:** on `pull_request`:
- job `dependency-review`: checkout, `actions/dependency-review-action` with `fail-on-severity: high`.
- job `audit`: checkout, setup-node 20 with npm cache, `npm ci`, `npm audit --audit-level=high`.
**Acceptance:** both checks green on the PR. On a local throwaway branch (never pushed), adding
`"lodash": "4.17.20"` makes `npm audit --audit-level=high` exit non-zero; record that in the PR.

### 2.3 Secret scanning in CI and pre-commit
**Files:** `.github/workflows/security.yml` (new job), `.githooks/pre-commit`, new `.gitleaks.toml`,
`docs/agents/api.md` (one line on the hook).
**Steps:**
1. CI job `gitleaks`: checkout with `fetch-depth: 0`, then run the official gitleaks Docker image
   pinned by digest: `docker run --rm -v "$PWD:/repo" zricethezav/gitleaks@sha256:<digest> git /repo --redact --exit-code 1`.
2. `.gitleaks.toml`: `[extend] useDefault = true`, plus an allowlist for test fixtures with fake
   tokens (paths under `tests/` and the fixed test session secret string).
3. Pre-commit: run `gitleaks protect --staged --redact` when `gitleaks` is on `PATH`; print one
   line and continue when it is not installed (the CI job is the enforcing check).
**Acceptance:** CI `gitleaks` job green. Locally, staging a file containing `ghp_` followed by 36
random letters makes `gitleaks protect --staged` exit 1 (do not commit it).

### 2.4 Shaked: repository settings
Enable secret scanning and push protection. Require these checks on `main`:
`Unit tests (vitest)`, `E2E tests (playwright)`, `Smoke test against the local API`, CodeQL,
`dependency-review`, `audit`, `gitleaks`. Tasks 3 and 5 add more.

---

## Task 3 — Quality gates

Status: Not started. One PR per sub-task.

### 3.1 ESLint
**Files:** `package.json`, new `eslint.config.js`, files with real lint errors, `.github/workflows/tests.yml`.
**Steps:**
1. `npm install -D eslint @eslint/js globals eslint-plugin-react eslint-plugin-react-hooks`
2. `eslint.config.js` (flat config): `js.configs.recommended`; React and hooks recommended for
   `src/**/*.{js,jsx}`; node globals for `server/**`, `api/**`, `scripts/**`; vitest globals for
   `tests/**`. Rules: `no-unused-vars: error` (args after-used, ignore `^_`),
   `complexity: [error, 20]`, `eqeqeq: error`, and for `server/**` and `api/**`
   `no-console: [error, { allow: ['error', 'warn'] }]`.
3. Scripts: `"lint": "eslint ."`; `precommit:checks` becomes
   `npm run docs:refresh && npm run lint && npm run build && npm run test:unit`.
4. Add a `Lint` step (`npm run lint`) to the unit job in `tests.yml`.
5. Fix errors by deleting dead code or fixing the bug. `eslint-disable` only with a reason on the same line.
**Acceptance:** `npm run lint` exits 0 locally and in CI; the PR lists every disable (target: none).

### 3.2 knip (unused files, exports, dependencies)
**Files:** `package.json`, new `knip.json`, CI step.
**Steps:** `npm install -D knip`. `knip.json`: `entry` = `src/main.jsx`, `api/handler.js`,
`scripts/*.{mjs,js}`, `tests/**/*.{test,spec}.{js,jsx,ts}`, `playwright.config.ts`,
`vitest.config.js`, `vite.config.js`; `project` = `src/**`, `server/**`, `api/**`, `scripts/**`.
Script `"knip": "knip"`. Delete what it reports; put a confirmed false positive in `ignore`
with a comment.
**Acceptance:** `npx knip` exits 0; the PR lists removed files, exports and dependencies.

### 3.3 jscpd (duplicate code)
**Files:** `package.json`, new `.jscpd.json`, CI step.
**Steps:** `npm install -D jscpd`. Config: `path: ["src","server","api","scripts"]`,
`minTokens: 50`, `reporters: ["console"]`. Run once without a threshold, then set `threshold`
to the measured percentage rounded up to one decimal. Script `"dup": "jscpd"`.
**Acceptance:** `npm run dup` exits 0 in CI; the PR shows the measured value and the threshold.

### 3.4 Slop scan
**Files:** new `scripts/slop-scan.mjs`, new `tests/unit/slop-scan.test.js`, `package.json`, CI step.
**Steps:** export `scan(text, path)` and a CLI that scans tracked files under `src/`, `server/`,
`api/`, `scripts/` (`git ls-files`). It fails on:
- `TODO`, `FIXME`, `XXX`, `HACK`, `lorem ipsum` (case-insensitive) on any line;
- 3 or more consecutive `//` comment lines that look like code (text after `//` ends with `;`, `{`, `}` or `)`);
- an empty `catch` block (`catch (...) {}` or `catch {}` with only whitespace inside).
A line ending with `// slop-ok: <reason of 3+ words>` is skipped. Output: `file:line: rule`.
**Tests:** one fixture per rule plus one `slop-ok` fixture.
**Acceptance:** `node scripts/slop-scan.mjs` exits 0 on the repo; the test passes.

### 3.5 Net-lines rule
**Files:** new `scripts/net-lines.mjs`, new `tests/unit/net-lines.test.js`, new `.github/workflows/net-lines.yml`.
**Steps:**
1. Input: `git diff --numstat origin/main...HEAD` and the PR body from env `PR_BODY`.
2. Count added and removed lines only under `src/`, `server/`, `api/`, `scripts/`, excluding
   `*.test.*`, `tests/`, `docs/` and lockfiles.
3. Pass when added ≤ removed, or when the PR body matches
   `docs/plans/[a-z0-9-]+\.md.*Task \d+(\.\d+)?` (a planned feature or test). Print both counts and the reason.
4. Workflow on `pull_request`: checkout with `fetch-depth: 0`, `git fetch origin main`, pass
   `PR_BODY: ${{ github.event.pull_request.body }}` through `env` only (never inline it in a `run:`
   script; that would allow command injection from the PR body).
**Tests:** counting, exclusions, plan-reference exemption.
**Acceptance:** the check runs on its own PR and passes via the line
"Implements docs/plans/post-migration-hardening.md Task 3.5".

Shaked adds `Lint`, `knip`, `dup`, `slop`, `net-lines` to the required checks after 3.5.

---

## Task 4 — Test time budget

Status: Not started. One PR.

**Why:** 10 of 14 files exceed 3 s in CI; each API file boots PGlite and runs every migration.
**Files:** `vitest.config.js`, new `tests/api/helpers/global-setup.js`, `tests/api/helpers/db.js`,
new `scripts/test-budget.mjs`, `.github/workflows/tests.yml`, `package.json`.
**Steps:**
1. Two vitest projects in `vitest.config.js` (`test.projects`): `unit` (`tests/unit/**`,
   environment `jsdom`, current setup file) and `api` (`tests/api/**/*.test.js`, environment
   `node`, `globalSetup: tests/api/helpers/global-setup.js`). API tests do not need jsdom.
2. `global-setup.js`: create one `PGlite`, run `applyMigrations`, `await pg.dumpDataDir('gzip')`,
   write it to `node_modules/.cache/xt-test/pglite-<sha256 of all db/migrations/*.sql>.tgz`
   (reuse when present), and `project.provide('pgliteSnapshot', <path>)`.
3. `helpers/db.js`: `inject('pgliteSnapshot')`, then
   `new PGlite({ loadDataDir: new Blob([await readFile(path)]) })`; do not run `applyMigrations`.
4. `tests/api/migrate.test.js` keeps a fresh PGlite (it tests migrations themselves).
5. `scripts/test-budget.mjs`: runs `vitest run --reporter=json --outputFile=<tmp file>`, reads
   each file's `startTime`/`endTime` and the total wall time, fails when a file > 3000 ms or the
   total > 30000 ms, prints the 5 slowest files. Script `"test:budget"`; the CI unit-test step uses it.
**Acceptance:**
- In CI: every file ≤ 3 s and total ≤ 30 s (paste the 5 slowest lines from the log).
- Locally on a 2-vCPU machine: total ≤ 30 s.
- Temporarily setting the file limit to 100 ms makes `npm run test:budget` exit 1 (not committed).
**Stop if:** `migrate.test.js` alone exceeds 3 s after the split (report the number; Shaked
decides between splitting it and a per-file exception).

---

## Task 5 — Codex as the blocking reviewer

Status: Not started.

### 5.1 Spike: when does Codex review (no code)
Find out, then report to Shaked and wait:
1. Does Codex re-review on every push, or only on "PR opened" and `@codex review` comments?
   (Compare the "Review trigger" column of its summary comment across pushes on PRs #23–#25.)
2. If it does not re-review on push: Shaked enables automatic reviews on every push in Codex
   settings if that option exists. Otherwise the gate posts `@codex review` on each push; verify
   once on a throwaway PR that a comment from `github-actions[bot]` starts a review.

### 5.2 Gate workflow
**Files:** new `.github/workflows/codex-gate.yml`, new `scripts/codex-gate.mjs`,
new `tests/unit/codex-gate.test.js`, fixtures under `tests/unit/fixtures/codex/`.
**How Codex reports (observed on PRs #23–#25):**
- One summary issue comment with `<!-- codex-pull-request-review-summary -->` and a state marker
  `<!-- codex-review-state:v1 {...} -->` whose braces are HTML-escaped (`&#123;`, `&#125;`). The
  JSON has `code_review.commit_sha`, `code_review.status` (`running` / `completed`) and
  `code_review.has_unresolved_findings`.
- Each finding is a review comment by `chatgpt-codex-connector[bot]` whose body starts with a
  severity badge (`![P0 Badge]` … `![P3 Badge]`) and contains `<!-- codex-code-review-finding:v1 -->`.
**Workflow:**
- Triggers: `pull_request` (opened, synchronize, reopened), `pull_request_review` (submitted),
  `pull_request_review_comment` (created, edited), `pull_request_review_thread` (resolved,
  unresolved), `issue_comment` (created, edited; skip when the issue is not a PR).
- `permissions: contents: read, pull-requests: read, checks: write`. Never check out or run PR code.
- `concurrency: codex-gate-<PR number>` with `cancel-in-progress: true`.
- Logic in `scripts/codex-gate.mjs` (pure functions, unit-tested), run after checking out `main`:
  1. Read the PR head SHA.
  2. Find or create a check run named **`Codex review`** on that SHA.
  3. Parse the summary marker. Missing, stale (`commit_sha` ≠ head) or not `completed` →
     check run `in_progress` with "Waiting for Codex on <sha7>"; stop.
  4. GraphQL `reviewThreads(first: 100)`: keep threads whose first comment is by
     `chatgpt-codex-connector[bot]` with the finding marker and `isResolved: false`.
  5. Any unresolved `P0` or `P1` → `failure`, with each listed as `P1 path:line title` and a link.
     Otherwise `success`, listing `P2`/`P3` as notes.
- A thread a human resolves counts as handled (resolving fires `pull_request_review_thread`).
- Fork PRs get a read-only token; the job then fails closed with a clear message.
**Tests:** marker parser (escaped braces, missing marker, stale SHA, `running`); severity filter;
fixture bodies copied from PRs #23–#25.
**Acceptance:**
- On the gate's own PR: `Codex review` stays `in_progress` until Codex finishes, then concludes.
- A throwaway PR with a seeded obvious bug (e.g. SQL built from request input) gets a `P0`/`P1`
  finding and the check fails; resolving the thread turns it green. Close it without merging.
- Shaked marks `Codex review` required.
**Stop if:** Codex no longer marks severity with `P0`–`P3` badges (report the new format).

---

## Task 6 — Light theme and friendlier UI

Status: Not started. One PR per sub-task, in order. Every UI PR attaches before/after
screenshots from 6.0 at 390 px and 1280 px width (both themes from 6.2 on).

### 6.0 Screenshot harness
**Files:** new `tests/e2e/screens.spec.ts`, `playwright.config.ts` (a `screens` project, not run by default),
`.github/workflows/tests.yml` (a `workflow_dispatch`-only job that uploads the PNGs).
**Steps:** the spec starts from the local headless API (`npm run dev:api`, token from `/api/dev/token`)
and captures: login, draft list (empty and with 3 drafts), editor (3 posts, one with an image),
preview page, share page, tokens page, into `test-results/screens/<width>/<name>.png`.
Script `"screens": "playwright test --project=screens"`.
**Acceptance:** `npm run screens` writes 7 PNGs per width.

### 6.1 Design tokens (no visual change)
**Files:** `src/styles/App.css` and any component with inline colors.
**Steps:**
1. List colors: `grep -oE '#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)' src/styles/App.css | sort | uniq -c | sort -rn`.
2. On `:root`, define with today's dark values: `--bg`, `--surface`, `--surface-2`, `--text`,
   `--muted`, `--border`, `--accent`, `--accent-text`, `--danger`, `--success`, `--warning`,
   `--focus`, `--overlay`. Map every color to the nearest token; keep two tokens only when the
   difference is visible.
3. Spacing and radius: `--space-1` … `--space-6` = 4, 8, 12, 16, 24, 32 px; `--radius` 12 px, `--radius-sm` 8 px.
**Acceptance:** hex colors appear only in the token block; screenshots before/after look the same;
`App.css` is shorter than 1,789 lines.

### 6.2 Light default + Light / Dark / System setting
**Files:** `index.html`, `src/styles/App.css`, new `src/utils/theme.js`,
new `src/components/ThemeSetting.jsx`, `src/App.jsx`, `src/components/EmojiPicker.jsx`,
`src/components/TweetEmbed.jsx`, `vite.config.js`, new `tests/unit/theme.test.js`,
new `tests/unit/contrast.test.js`.
**Steps:**
1. Light values on `:root`; dark values under `:root[data-theme="dark"]` and inside
   `@media (prefers-color-scheme: dark) { :root[data-theme="system"] { … } }`.
   Starting light palette: bg `#ffffff`, surface `#f7f9fa`, surface-2 `#eff3f4`, text `#0f1419`,
   muted `#536471`, border `#cfd9de`, accent `#1d9bf0`, accent-text `#ffffff`, danger `#f4212e`,
   success `#00ba7c`, warning `#b45309`, focus `#1d9bf0`. Change a value only to pass the contrast test.
2. `index.html`: an inline `<script>` in `<head>`, before the stylesheet, sets
   `document.documentElement.dataset.theme` from `localStorage['xt-theme']` (`light` | `dark` |
   `system`, default `light`), inside `try/catch`, and sets `<meta name="color-scheme">` and
   `<meta name="theme-color">`.
3. `theme.js`: `getTheme()`, `setTheme(value)` (validate, write storage in try/catch, update the
   attribute and meta tags), `resolvedTheme()` (`light` or `dark`, using `matchMedia` for `system`).
4. `ThemeSetting.jsx`: a radio group shown as three segments, labelled "Light", "Dark",
   "Match device", keyboard accessible; placed in the header menu and on the settings page.
5. Emoji picker and tweet embed use `resolvedTheme()` (they hard-code `light` today).
6. PWA manifest `theme_color` and `background_color` stay light (`#ffffff`).
**Tests:** `theme.test.js`: default light; persists; invalid stored value ignored; `system`
resolves via a `matchMedia` mock. `contrast.test.js`: reads the token values for both themes and
asserts WCAG contrast ≥ 4.5 for text/bg, text/surface, muted/bg, accent-text/accent, danger/bg,
and ≥ 3 for border/bg and focus/bg.
**Acceptance:** first visit renders light; choosing Dark survives a reload; tests pass; screenshots in both themes.

### 6.3 Friendlier UI, one screen group per PR
**Principles (every screen):**
- One clear primary action per screen (filled accent button); secondary actions outlined;
  destructive actions red and confirmed.
- Plain words that say what happens ("Copy link", "Delete draft"); technical details go in help text.
- Every empty state says what to do next and has the action button.
- Status (saving, saved, offline, sync error) in one consistent place, calm wording, never color alone.
- Touch targets ≥ 44 × 44 px; body text ≥ 16 px; editor line length ≤ 70 characters.
- Phone first: one column at 390 px; editor actions in a sticky bottom bar.
- Visible focus ring (`--focus`), a label on every input, `aria-live` on status messages.
- Remove the deployment banner (`.deployment-meta`: deployed at / commit) from the top of every
  page; show it as one small "About" line at the bottom of the settings page.

**Order (one PR each):**
- 6.3a Editor: `DraftEditor`, `ThreadComposer`, `PostBox`, `CharacterCounter`, `ImageUpload`,
  `EmojiPicker`. **Shaked approves this look on the preview before 6.3b starts;** later PRs reuse its patterns.
- 6.3b Draft list and login: `DraftList`, `LoginPage`.
- 6.3c Sharing and preview: `ShareButton`, `ExportOptions`, `XThreadLinkButton`, `AgentLinkButton`,
  `XThreadPreviewPage`, `ThreadPreview`.
- 6.3d Settings: `TokensPage` (with "Connected apps" from Task 7.8, if merged; otherwise a placeholder-free version).

**Each PR description:** a before/after table of every visible label that changed, and screenshots.
**Acceptance per PR:** Shaked approves on the preview; E2E green; net-lines passes (markup and CSS
should shrink, or cite this task); contrast test passes; no new hard-coded colors.

---

## Task 7 — Keyless auth: GitHub OIDC for CI, MCP connector for agents

Status: Not started. One PR per sub-task, in order. Before 7.5, read the current MCP authorization
spec: <https://modelcontextprotocol.io/specification/latest/basic/authorization> (version
2026-07-28 at planning time). Where this plan and the spec disagree, follow the spec and say so in the PR.

### Design summary
- **Two resources:** REST API `<origin>/api` and MCP server `<origin>/api/mcp`. Every access token
  is bound to exactly one (`oauth_grants.resource`); a token for one is refused by the other
  (RFC 8707 audience binding, required by the spec).
- **Authorization server:** this app, `issuer` = `<origin>`; the human signs in with GitHub.
- **Client registration:** Client ID Metadata Documents (client_id is an https URL; the spec's
  preferred method) and Dynamic Client Registration (deprecated in the spec, still used by many clients).
- **Tokens:** opaque random strings; only SHA-256 hashes stored. Access `xta_…`, 1 hour. Refresh
  `xtr_…`, rotates on every use, expires after 90 days unused; reuse of a spent refresh token
  revokes the whole grant. Hand-made `xt_` tokens stay, 7 days maximum (D4).
- **One scope:** `drafts` (everything the signed-in user can do in the UI).
- **CI:** GitHub Actions OIDC tokens, accepted only for a dedicated `ci-smoke` user.
- `<origin>` below means `PUBLIC_APP_URL` without a trailing slash.

### 7.1 GitHub Actions OIDC for the smoke test
**Files:** new `server/oidc-ci.js`, `server/session.js`, `server/github-user.js` (if the upsert
lives there), new `tests/api/oidc-ci.test.js`, `.github/workflows/smoke-deployed.yml`, `docs/agents/api.md`.
**Steps:**
1. `oidc-ci.js` verifies a bearer JWT with `jose`: `createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'))`
   (module-level, so it is cached), `issuer: 'https://token.actions.githubusercontent.com'`,
   `audience: 'x-thread-draft-tool-smoke'`, `algorithms: ['RS256']`, `maxTokenAge: '10m'`.
   Required claims: `repository_id === process.env.CI_OIDC_REPOSITORY_ID` (the numeric id, so a
   renamed or recreated repository cannot match); `workflow_ref` starts with
   `Shaked/x-thread-draft-tool/.github/workflows/smoke-deployed.yml@`; `event_name` is
   `deployment_status` or `workflow_dispatch`.
2. On success, upsert a user with `login = 'ci-smoke'`, `github_id = -1` (real GitHub ids are
   positive) and return `{ uid, gh: '-1', login: 'ci-smoke', via: 'ci-oidc' }`. This user only
   sees its own drafts, so a leaked CI token cannot read anyone's data.
3. `session.authenticate`: a bearer value shaped like a JWT (three base64url parts) is checked with
   `oidc-ci.js` only when `CI_OIDC_ENABLED === '1'`; otherwise it is a 401 as today.
4. Workflow: job `permissions: id-token: write, contents: read`. Fetch the token with
   `curl -sS -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=x-thread-draft-tool-smoke" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).value"`,
   `echo "::add-mask::$token"`, pass it as `XT_TOKEN`. Run the full smoke test on every
   environment (the smoke user is created on each preview database branch on first use). Remove
   the `XT_SMOKE_TOKEN*` and `XT_SMOKE_PUBLIC` handling from the workflow (keep the script option for local use).
5. **Shaked does:** Vercel env vars `CI_OIDC_ENABLED=1` and `CI_OIDC_REPOSITORY_ID=<id>` for
   Preview, later Production. The executor posts the id in the PR
   (`gh api repos/Shaked/x-thread-draft-tool --jq .id`; not a secret).
**Tests (a local RS256 key pair and a mocked JWKS):** a valid token → smoke user; wrong audience,
wrong issuer, wrong `repository_id`, another workflow file, other `event_name`, expired,
`alg: none`, HS256 signed with the public key bytes → 401; flag off → 401.
**Acceptance:** preview smoke run 16/16 with no `XT_SMOKE_TOKEN` in the job. After Shaked enables
Production and approves one production run: 16/16. Then Shaked deletes both `XT_SMOKE_TOKEN*` secrets.

### 7.2 Deployment Protection bypass secret
Shaked chooses in the Vercel dashboard: turn off Vercel Authentication for previews (the app has
its own GitHub login) and delete `VERCEL_AUTOMATION_BYPASS_SECRET`, or keep it and rotate it (the
old value was pasted in a chat). The executor then removes or keeps the header in `scripts/smoke.mjs`.
**Acceptance:** preview smoke passes after the change.

### 7.3 Database: OAuth tables
**Files:** new `db/migrations/003_oauth.sql`.
Additive only (the migration lint blocks `drop`, `delete`, `truncate`):
```sql
create table if not exists oauth_clients (
  client_id text primary key,              -- 'xtc_…' (registered), an https URL (metadata document) or 'device:<name>'
  kind text not null,                      -- 'registered' | 'metadata' | 'device'
  client_name text not null,
  redirect_uris text[] not null default '{}',
  metadata_fetched_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists oauth_grants (  -- one row per user, client and resource: a "Connected app"
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  client_id text not null references oauth_clients(client_id) on delete cascade,
  scope text not null,
  resource text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  unique (user_id, client_id, resource)
);
create table if not exists oauth_codes (
  code_hash text primary key,
  grant_id uuid not null references oauth_grants(id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  expires_at timestamptz not null,         -- 60 seconds after creation
  used_at timestamptz
);
create table if not exists oauth_tokens (
  token_hash text primary key,
  grant_id uuid not null references oauth_grants(id) on delete cascade,
  kind text not null,                      -- 'access' | 'refresh'
  expires_at timestamptz not null,
  used_at timestamptz,                     -- refresh tokens: set when rotated
  created_at timestamptz not null default now()
);
create index if not exists oauth_tokens_grant_idx on oauth_tokens(grant_id);
create index if not exists oauth_grants_user_idx on oauth_grants(user_id);
```
**Acceptance:** `npm run test:unit` passes, including the idempotency test in `migrate.test.js`.

### 7.4 Token service and the 7-day cap
**Files:** new `server/oauth/tokens.js`, new `tests/api/oauth-tokens.test.js`, `server/session.js`,
`server/tokens.js`, `src/pages/TokensPage.jsx` (expiry choices 1–7 days), `tests/api/tokens.test.js`.
**Functions in `server/oauth/tokens.js`:**
- `issuePair(grantId)` → `{ access_token: 'xta_…', refresh_token: 'xtr_…', token_type: 'Bearer', expires_in: 3600, scope: 'drafts' }`
  (32 random bytes base64url each; store hashes; access expires +1 h, refresh +90 days).
  Also deletes up to 100 rows `where expires_at < now() - interval '1 day'`.
- `rotate(refreshToken, clientId)`: in **one statement**
  `update oauth_tokens set used_at = now() where token_hash = $1 and kind = 'refresh' and used_at is null and expires_at > now() returning grant_id`
  so two concurrent refreshes cannot both succeed. No row: if the hash exists with `used_at` set,
  revoke the grant (reuse detection). Return `invalid_grant` in both failure cases. Check the grant's
  `client_id` equals `clientId` and the grant is not revoked; then `issuePair` and update `last_used_at`.
- `resolveAccess(token, expectedResource)` → caller `{ uid, gh, login, via: 'oauth', grantId }` or
  null. Requires `kind = 'access'`, not expired, grant not revoked, `grant.resource = expectedResource`.
**`session.authenticate`:** `Bearer xta_…` → `resolveAccess(token, '<origin>/api')`; `xt_` path
unchanged; anything else → 401 (CI OIDC from 7.1 aside). Never fall back to the cookie when an
Authorization header is present.
**`server/tokens.js`:** `expiresInDays` range 1–7, default 7.
**Tests:** issue; resolve; expiry (set `expires_at` in the past with SQL); rotation; reuse revokes the
grant; concurrent rotate with `Promise.all` (exactly one succeeds); wrong client; audience mismatch →
null; revoked grant → null; `xt_` token with `expires_in_days: 8` → 400.

### 7.5 Authorization server endpoints
**Files:** new `server/routes/oauth.js`, new `server/oauth/clients.js`, new `server/oauth/consent.js`,
`server/router.js`, `server/routes/auth.js`, `vercel.json`, `server/openapi.js`, new `tests/api/oauth.test.js`.
**Routing:** in `vercel.json`, before the SPA fallback, add
`{ "source": "/.well-known/:path*", "destination": "/api/handler?__path=.well-known/:path*" }`.
**Endpoints:**
1. `GET /.well-known/oauth-protected-resource` and `GET /.well-known/oauth-protected-resource/api/mcp` →
   `{ "resource": "<origin>/api/mcp", "authorization_servers": ["<origin>"], "scopes_supported": ["drafts"], "bearer_methods_supported": ["header"] }`.
2. `GET /.well-known/oauth-authorization-server` → `issuer`, `authorization_endpoint`
   (`<origin>/api/oauth/authorize`), `token_endpoint` (`/api/oauth/token`), `registration_endpoint`
   (`/api/oauth/register`), `revocation_endpoint` (`/api/oauth/revoke`),
   `response_types_supported: ["code"]`, `grant_types_supported: ["authorization_code","refresh_token"]`,
   `code_challenge_methods_supported: ["S256"]`, `token_endpoint_auth_methods_supported: ["none"]`,
   `scopes_supported: ["drafts"]`, `client_id_metadata_document_supported: true`,
   `authorization_response_iss_parameter_supported: true`. All URLs absolute.
3. `POST /api/oauth/register` (JSON, no auth): `client_name` 1–100 chars; `redirect_uris` 1–5, each
   `https://…` or `http://localhost[:port]/…` or `http://127.0.0.1[:port]/…`, no fragment;
   `token_endpoint_auth_method` absent or `none`. 201
   `{ client_id: 'xtc_…', client_name, redirect_uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code','refresh_token'], response_types: ['code'] }`.
   Each call deletes up to 100 `registered` clients older than 1 day with no grants.
4. `clients.js` `getClient(clientId)`: an https URL → fetch its metadata document: https only;
   resolve DNS and refuse private addresses with `isPrivateAddress` from `server/remote-image.js`;
   3 s timeout; ≤ 10 KB; `redirect: 'manual'` (no redirects); JSON content type. Require
   `doc.client_id === clientId`, a `redirect_uris` array (same URI rules as registration) and
   `client_name`. Cache as `kind = 'metadata'`; refetch after 24 h.
5. `GET /api/oauth/authorize`: `response_type=code`, `client_id`, `redirect_uri`, `code_challenge`
   (43–128 chars of `[A-Za-z0-9-._~]`), `code_challenge_method=S256`, `state` (optional, ≤ 500 chars),
   `scope` (absent or `drafts`), `resource` (absent means `<origin>/api/mcp`; otherwise it must be
   `<origin>/api/mcp` or `<origin>/api`).
   - Unknown client, or `redirect_uri` not an exact match of a registered URI → **an HTML error
     page, never a redirect** (no open redirect).
   - Any other invalid parameter → redirect to `redirect_uri` with `error=invalid_request`, `state`, `iss=<origin>`.
   - No session cookie → 302 to `/api/auth/login?return_to=<path and query of this request>`.
   - Signed in → the consent page (plain server HTML from `consent.js`, no React): the app name,
     the redirect host, a "not verified" note for `registered` clients, what it can do ("Read,
     create, edit, publish, share and delete your drafts"), Approve and Deny buttons. Headers:
     `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'`,
     `Cache-Control: no-store`. All values HTML-escaped.
   - The form posts to `POST /api/oauth/authorize` with one hidden field `request`: an HS256 JWT
     (key from `SESSION_SECRET`, `aud: 'oauth-consent'`) holding the validated parameters and `uid`, valid 10 minutes.
6. `POST /api/oauth/authorize` (form body): verify the `request` JWT and that its `uid` equals the
   session's (CSRF and session binding; else 403). Deny → redirect with `error=access_denied`,
   `state`, `iss`. Approve → upsert the grant (clear `revoked_at`), create a code (32 random bytes,
   hash stored, 60 s), redirect to `redirect_uri?code=…&state=…&iss=<origin>`.
7. `POST /api/oauth/token` (`application/x-www-form-urlencoded`):
   - `grant_type=authorization_code` with `code`, `redirect_uri`, `client_id`, `code_verifier`,
     `resource`: code exists, unexpired, unused (mark used in one statement), same client and
     redirect URI, `base64url(sha256(code_verifier)) === code_challenge`, `resource` equals the
     grant's. A second use of a code revokes the grant. Success → `issuePair`.
   - `grant_type=refresh_token` with `refresh_token`, `client_id` → `rotate`.
   - Errors: 400 JSON `{ error, error_description }` with `invalid_request`, `invalid_grant`,
     `invalid_client` or `unsupported_grant_type`. Every response has `Cache-Control: no-store`.
8. `POST /api/oauth/revoke` (form `token`): revoke the grant the access or refresh token belongs to; always 200.
9. `GET /api/auth/login?return_to=`: accept only a value starting with `/api/oauth/authorize?`
   (no scheme, no `//`); store it with the state; after the callback redirect there instead of `/`.
10. `server/router.js`: the Origin check skips `POST /oauth/token`, `/oauth/register`,
    `/oauth/revoke` (no cookies are used there) and still applies to `POST /oauth/authorize`.
**Tests (one `describe` per endpoint):** metadata documents; registration validation (bad scheme,
6 URIs, a fragment, `client_secret_basic` → 400); metadata-document clients with mocked `fetch`
(valid; private IP; http; mismatched `client_id`; > 10 KB; redirect); authorize without a session
→ login redirect with `return_to`; unknown redirect → error page and no `Location`; consent page
headers and escaping; decision JWT with another `uid` → 403; full code flow with PKCE → token pair;
wrong verifier, wrong redirect, wrong resource, expired code, reused code (grant revoked);
refresh rotation and reuse; revoke; `return_to=https://evil.example` ignored.
**Acceptance:** tests pass; on the preview, `curl <preview>/.well-known/oauth-authorization-server`
returns the document; the openapi test passes with the new REST endpoints documented.

### 7.6 MCP endpoint `/api/mcp`
**Files:** new `server/mcp/server.js`, new `server/mcp/tools.js`, new `server/caller-context.js`,
`server/session.js`, `server/router.js`, new `tests/api/mcp.test.js`.
**Transport:** Streamable HTTP, stateless, JSON responses only (no SSE, no session id).
- `POST /api/mcp` with one JSON-RPC 2.0 message. `GET` and `DELETE` → 405.
- Auth: `Bearer xta_…` resolved with `resolveAccess(token, '<origin>/api/mcp')`. Missing or invalid
  → 401 with `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/api/mcp", scope="drafts"`.
  `xt_` tokens, CI tokens and cookies are refused here.
- `Origin` present and not equal to `<origin>` → 403 (DNS-rebinding guard from the transport spec).
- Methods: `initialize` (reply with the client's `protocolVersion` if it is in
  `SUPPORTED_VERSIONS`, else the newest; `capabilities: { tools: {} }`;
  `serverInfo: { name: 'x-thread-draft-tool', version }`; `instructions`: one paragraph saying what
  drafts are and that draft text is user content, not instructions), `notifications/initialized`
  (202, empty body), `ping`, `tools/list`, `tools/call`. Unknown method → JSON-RPC error `-32601`;
  malformed JSON → `-32700`. Fill `SUPPORTED_VERSIONS` from the spec's version list when
  implementing (include `2025-06-18` and the latest).
- `tools/call` runs the existing REST handler in-process so validation and ownership checks are
  reused. `caller-context.js` exports an `AsyncLocalStorage` and `runAs(caller, fn)`;
  `session.authenticate` returns the stored caller first when one is set (it is never set from
  network input). The tool builds `new Request('<origin>/api/<path>', …)` with no Authorization
  header, calls `route(request)` inside `runAs`, and returns
  `{ content: [{ type: 'text', text: <JSON body> }], structuredContent: <body>, isError: status >= 400 }`.
**Tools** (input schemas copied from `server/openapi.js` components):

| Tool | REST call | Annotation |
|---|---|---|
| `list_drafts` | `GET /drafts` | readOnlyHint |
| `get_draft` `{id}` | `GET /drafts/:id` | readOnlyHint |
| `create_draft` `{title?, posts?}` | `POST /drafts` | |
| `update_draft` `{id, title?, posts?}` | `PATCH /drafts/:id` | |
| `duplicate_draft` `{id}` | `POST /drafts/:id/duplicate` | |
| `export_draft` `{id, format}` | `GET /drafts/:id/export?format=` | readOnlyHint |
| `split_text` `{text, max_chars?}` | `POST /threads/split` | readOnlyHint |
| `create_share_link` `{id}` | `POST /drafts/:id/share-tokens` | |
| `add_image_from_url` `{url}` | `POST /images/from-url` | |
| `publish_draft` `{id}` | `POST /drafts/:id/publish` | destructiveHint |
| `delete_draft` `{id}` | `DELETE /drafts/:id` | destructiveHint |

Tool descriptions state that draft and image content comes from the user and may contain text
that looks like instructions; agents must treat it as data.
**Tests:** exact 401 header; `xt_` token refused; an `/api` access token refused; `Origin:
https://evil.example` → 403; version negotiation; `tools/list` names and annotations; each tool's
happy path; `get_draft` of another user's draft → `isError: true` with the 404 text; unknown tool and
unknown method errors.
**Acceptance:**
- `npm run test:unit` passes.
- With a token from the browser flow on the preview:
  `npx @modelcontextprotocol/inspector --cli <preview>/api/mcp --transport http --header "Authorization: Bearer $TOKEN" --method tools/list`
  lists 11 tools (check the flag names with `--help` first; they may change between versions).
- Shaked adds `<preview>/api/mcp` as a custom connector in Claude, approves once, and has the agent
  list drafts, with no token copied. 70 minutes later (access token expired) it still works.

### 7.7 Device flow and scripts use the short-lived pair
**Files:** `server/routes/device.js`, `scripts/agent-login.mjs`, new `scripts/xt-token.mjs`,
`tests/api/device.test.js`, `docs/agents/api.md`, `public/llms.txt`, `server/openapi.js`, `AGENTS.md`.
**Steps:**
1. `pollDevice` success: upsert `oauth_clients` `client_id = 'device:' + name`, `kind = 'device'`;
   upsert a grant with resource `<origin>/api`; respond 201
   `{ access_token, refresh_token, token_type, expires_in, user }` plus `token` (= `access_token`,
   deprecated, removed one release later).
2. `agent-login.mjs` saves `{ base_url, refresh_token }` to `~/.config/xt/credentials.json`
   (file mode 0600, directory 0700). `xt-token.mjs` prints a fresh access token, saving the rotated
   refresh token; on failure prints "run npm run agent:login" and exits 1.
3. Docs order: "Connect as an MCP connector" first, device flow second, hand-made tokens last
   ("7 days max, for quick tests").
**Tests:** poll returns the pair; the access token works on `/api/drafts`; refresh works; the token is refused on `/api/mcp`.
**Acceptance:** against `npm run dev:api` (add a dev-only device stub next to `/api/dev/token` if
needed): `npm run agent:login` once, then `XT_TOKEN=$(node scripts/xt-token.mjs) npm run smoke`
passes twice in a row, the second time after a refresh.

### 7.8 Settings: Connected apps
**Files:** new `server/routes/grants.js`, `server/router.js`, `server/openapi.js`,
`src/pages/TokensPage.jsx`, new `tests/api/grants.test.js`.
**Steps:** `GET /api/grants` (session or bearer) lists the user's grants: client name, kind, redirect
host, resource, created, last used, revoked. `DELETE /api/grants/:id` revokes (all its tokens stop
working). The page shows "Connected apps" above "Personal tokens (7 days max)".
**Acceptance:** after revoking a connected app its next MCP call returns 401 (API test, plus one manual check on the preview).

### 7.9 Cap existing hand-made tokens (last)
Only after 7.1 runs on Production (the old smoke tokens are no longer used).
**Files:** new `db/migrations/004_token_cap.sql`:
```sql
update api_tokens
   set expires_at = least(coalesce(expires_at, now() + interval '7 days'), now() + interval '7 days')
 where revoked_at is null;
```
**Acceptance:** after deploy, `GET /api/tokens` shows no active token expiring more than 7 days after the deploy.

---

## Order of work
1. Task 0 (0.1 → 0.3a → 0.2 → 0.3b) and Task 1.1. Task 1.2 after Supabase is deleted.
2. Task 2, then Task 3 (3.1 → 3.5).
3. Task 4.
4. Task 5 (5.1 report → 5.2).
5. Task 6 and Task 7 can run in parallel branches; inside each, keep the sub-task order. 6.3d comes after 7.8.

## Open items for Shaked (outside the tasks)
1. Remove `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel → Settings → Environment Variables.
2. Retire Supabase on or after 2026-11-21, then ask for Task 1.2.
3. Rotate or remove the Vercel automation bypass value (Task 7.2).
4. Phase 4 manual UI checks on the preview (from `vercel-migration.md`).
5. Merge order now: #24 (smoke fix), #25 (agent workflow skill), #23 (this plan).
