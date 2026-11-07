# Plan: Keyless agent auth, automated reviews, code quality gates, light UI

Status: **Planned, not started.** Decisions recorded 2026-11-07 (one open: see "Decisions").
Starts after the Supabase migration is finished. Task 0 can start now; tasks that remove
Supabase pieces wait for retirement on or after 2026-11-21
(Phase 4 in [vercel-migration.md](./vercel-migration.md)).
Owner: Shaked (decisions, dashboard steps), executor (implementation).

## Goal

1. **No long-lived secrets for GitHub or agents.** CI and agents get short-lived credentials
   automatically. An agent connects like any other connector: one approval, then automatic
   short-lived credentials, no hand-made tokens.
2. **Security and code review run on every pull request** without a human starting them.
3. **Code stays small and clean**: lint, dead code, duplicate code and slop are caught, and a change
   does not grow the codebase unless it adds a planned test or feature.
4. **Tests stay fast**: each test file ≤ 3 s, the unit + API suite ≤ 30 s.
5. **A light, friendlier UI**: light theme by default, and a UI that reads plainly to non-experts.

## Decisions

| Question | Answer | Date |
|---|---|---|
| Automated review: block or comment | **Blocks merges on high or critical findings** (required check). Lower severities comment only. | 2026-11-07 |
| Fix `npm audit` findings before the plan starts | **Yes, as Task 0.** Gates start green, no allowlist. | 2026-11-07 |
| Agent auth option | **Open — proposed: remote MCP connector on Vercel with OAuth** (see A). Shaked asked for the simplest option with no recurring human steps; the device flow alone was judged annoying. Needs a yes before Task 7 starts. | pending |
| Automated review tool | Executor proposes in Task 5. Constraint: no new long-lived secret in the repo (prefer a GitHub App install over an API-key secret). | pending |

## Baseline (re-measured 2026-11-07 on `main` @ 2e492a4)

| Item | Measured | Target |
|---|---|---|
| `npm audit` (all deps) | 39: 3 critical, 20 high, 13 moderate, 3 low | 0 high or critical |
| Critical findings | All 3 are **dev-only**: `vitest`, `@vitest/ui`, `tinypool` (fix needs a vitest major upgrade) | — |
| `npm audit --omit=dev` | 7: **4 high** (`@vercel/blob` → `@vercel/oidc` → `@vercel/cli-config` → `zod`), 3 moderate (`react-router-dom` open redirect) | 0 high or critical |
| Suite time in CI (`tests.yml`, run 42396689095) | 18.8 s, 14 files, 152 tests | ≤ 30 s |
| Suite time on a 2-vCPU sandbox | 31.5 s | ≤ 30 s |
| Per-file time in CI | **10 of 14 files over 3 s** (3.3–4.7 s): every PGlite-backed API file. Cause: PGlite boot + migrations per file (test bodies themselves are < 0.3 s). | every file ≤ 3 s |
| Duplicate CI work | `tests.yml` runs `test:unit` (already includes `tests/api`) and then `test:api` again: about 18 s wasted per run | run once |
| Linter | None. `npm run lint` is `vite build`. | ESLint |
| GitHub secrets in use | smoke: `XT_SMOKE_TOKEN`, `XT_SMOKE_TOKEN_PRODUCTION`, `VERCEL_AUTOMATION_BYPASS_SECRET`; one-time migration: `DATABASE_URL_UNPOOLED`, `BLOB_READ_WRITE_TOKEN`; Supabase: `SUPABASE_*`, `BACKUP_PASSPHRASE` | none long-lived |
| Agent credential | Device flow or web UI mints an `xt_` token valid 90 days by default (up to 365) | ≤ 1 h access token, refreshed automatically |
| UI | Dark only. `App.css` 1,789 lines, 209 hard-coded colors, 0 CSS variables. Emoji picker and tweet embed already render light. | Light default, design tokens |

## A. Keyless authentication

**CI (GitHub Actions):** after Supabase retirement and deletion of `data-migrate.yml`, the only
secrets left are the smoke-test ones. Replace them:
- The API accepts a **GitHub Actions OIDC token** (`permissions: id-token: write`) as a bearer
  credential, verified against GitHub's JWKS with a fixed issuer, audience
  (`x-thread-draft-tool`) and subject allowlist (`repo:Shaked/x-thread-draft-tool:ref:refs/heads/main`
  and the pull-request subject). It maps to one dedicated smoke-test user. Expiry is set by GitHub
  (minutes). This removes both `XT_SMOKE_TOKEN*` secrets.
- `VERCEL_AUTOMATION_BYPASS_SECRET`: preview Deployment Protection duplicates the app's own GitHub
  login. Proposed: turn off Vercel Authentication for previews and delete the secret. Shaked
  decides in the dashboard; if it stays on, the secret is rotated (open item 3) and kept as the one
  exception.

**Agents (proposed):** a **remote MCP server inside this Vercel project** at `/api/mcp` (a Vercel
function next to the existing API, same database, no new host). It follows the MCP authorization
spec: the app is the OAuth authorization server and delegates login to GitHub.
- Human steps: add the server URL as a connector once, click Approve on the GitHub login page.
  Nothing else, ever, unless access is revoked.
- The client (Claude, Codex, other MCP clients) registers itself, receives a 1-hour access token
  and a rotating refresh token, and refreshes on its own. Refresh tokens are stored hashed,
  rotate on every use, expire after 90 days without use, and are revocable on `/settings/tokens`.
- Tools mirror the existing JSON API (list, get, create, update, publish, share drafts), so there
  is one permission model.
- The existing device flow stays for headless scripts but mints the same short-lived access token
  + refresh pair instead of a 90-day `xt_` token. Hand-made `xt_` tokens are removed after agents
  have moved (one release later).

## B. Automated security and code review on every PR

- **CodeQL** (JavaScript) on push and pull request.
- **Dependency review** on pull requests: fails on new high or critical vulnerabilities.
- **Audit gate**: `npm audit --audit-level=high` (all dependencies, since Task 0 clears them).
- **Secret scanning**: GitHub secret scanning + push protection, `gitleaks` in CI and in the
  pre-commit hook.
- **Automated code review**: runs on every PR and reports as a check. High or critical findings
  fail the check; others are comments.
- All of the above become **required status checks** on `main` (Shaked enables in branch protection).

## C. Clean code, code reduction, slop

- **Lint**: ESLint (flat config) for `src/`, `server/`, `api/`, `scripts/`, `tests/`: unused vars,
  complexity limit, no `console.log` in `server/`. `npm run lint` runs ESLint, not `vite build`.
- **Dead code**: `knip`; fails on unused files, exports and dependencies.
- **Duplicates**: `jscpd` with a threshold set from the first measured run, then only lowered.
- **Slop scan** (`scripts/slop-scan.mjs`): fails on `TODO`, `FIXME`, `XXX`, `lorem`, commented-out
  code blocks and empty `catch` blocks, unless the line has `// slop-ok: <reason>`.
- **Net-lines rule** (`scripts/net-lines.mjs`, CI on PRs): added lines ≤ removed lines in
  `src/`, `server/`, `api/`, `scripts/`. Exempt: lines under `tests/` and `docs/`, and PRs whose
  description cites a task in a `docs/plans/` file (for a planned feature).

## D. Test time budget

- Build the migrated PGlite database **once** in a vitest `globalSetup`, save it with
  `dumpDataDir()`, and have `setupTestDb()` start each file from that snapshot with `loadDataDir`
  instead of running migrations.
- `scripts/test-budget.mjs` reads the vitest JSON report and fails when any file exceeds 3 s or the
  suite exceeds 30 s. Runs in CI.

## E. Light theme and friendlier UI

- **Design tokens first**: replace the 209 hard-coded colors with CSS custom properties
  (`--bg`, `--surface`, `--text`, `--muted`, `--border`, `--accent`, `--danger`, `--success`).
- **Light theme is the default.** Dark stays available: a three-way setting (Light / Dark /
  System) in the header, stored per browser. `color-scheme` and the PWA `theme_color` follow it.
- **Friendlier UI**: plain-language labels and help text, clear primary action per screen, empty
  states that say what to do next, larger touch targets (≥ 44 px), readable type scale, consistent
  spacing, and calmer status messages (save, sync, offline). Phone layout first: the app is used
  from a phone.
- **Accessibility**: WCAG AA contrast in both themes, visible focus, labelled controls.
- Done screen by screen so each PR stays reviewable and passes the net-lines rule (token work
  should shrink `App.css`).

## Tasks (in order)

Each task is one PR (or a commit per sub-step), with a changelog file, `npm run build`,
`npm run test:unit` and `npm run precommit:checks` passing. Nothing runs against production
without asking Shaked.

### Task 0 — Clear the audit findings
- 0.1 Upgrade `vitest` and `@vitest/ui` to the current major; fix config/API changes.
  Check: suite passes; `npm audit` shows 0 critical.
- 0.2 Fix the Blob chain (upgrade `@vercel/blob`, or an `overrides` entry for `zod` /
  `@vercel/oidc` if no release fixes it). Check: `npm audit --omit=dev` shows 0 high; image upload
  API tests pass; preview upload works (Phase 4 manual check).
- 0.3 Fix the remaining high and moderate findings (`vite`, `react-router-dom` and transitive ones
  `npm audit fix` can resolve). Check: `npm audit --audit-level=high` exits 0; `npm run build`
  passes; E2E passes in CI.

### Task 1 — CI cleanup
- 1.0 Fix the automatic deployed smoke test (red on every deployment since the migration merge,
  `main` included: 4/6, `401` on the token steps). Cause: it picks the token by matching the
  canonical production URL, but `deployment_status` passes the per-deployment URL; and each preview
  deployment gets its own database branch with no smoke-test user (the preview alias is pinned to
  one deployment). Fix: choose by `github.event.deployment.environment`: Production → full test
  with `XT_SMOKE_TOKEN_PRODUCTION`; Preview → public steps only (new `XT_SMOKE_PUBLIC=1` mode in
  `scripts/smoke.mjs`, account steps reported as SKIP); manual runs unchanged.
  Check: the next preview deployment's smoke run is green with the account steps skipped; the next
  production deployment runs all steps (asking Shaked before any production run).
- 1.1 Remove the duplicate `test:api` step from `tests.yml`. Check: API tests still run once (14 files in the log).
- 1.2 After Supabase retirement (≥ 2026-11-21, Shaked confirms the project is deleted): delete
  `supabase-backup.yml`, `data-migrate.yml`, `scripts/supabase-db-url.sh`,
  `scripts/migrate-from-supabase*` and its test. Shaked deletes `SUPABASE_*`, `BACKUP_PASSPHRASE`,
  `DATABASE_URL_UNPOOLED`, `BLOB_READ_WRITE_TOKEN` from GitHub secrets. Check: no workflow
  references those secrets (`grep secrets. .github/workflows`).

### Task 2 — Security gates
- 2.1 CodeQL workflow. Check: first run on the PR is green and appears as a check.
- 2.2 Dependency review + audit gate. Check: a test PR adding a known-vulnerable package fails.
- 2.3 gitleaks in CI and in `.githooks/pre-commit`. Check: a test commit with a fake token is rejected locally and in CI.
- 2.4 Shaked: enable secret scanning + push protection and mark 2.1–2.3 as required checks.

### Task 3 — Quality gates
- 3.1 ESLint; `npm run lint` runs it; fix or remove offending code. Check: `npm run lint` exits 0 in CI.
- 3.2 knip. Check: exits 0; removed items listed in the changelog.
- 3.3 jscpd with the measured threshold. Check: exits 0 in CI.
- 3.4 Slop scan. Check: exits 0; a fixture with a `TODO` fails it.
- 3.5 Net-lines rule. Check: runs on PRs; a PR that only adds code in `src/` without a plan reference fails.

### Task 4 — Test budget
- 4.1 PGlite snapshot in `globalSetup`. Check: every API file ≤ 3 s in CI; suite ≤ 30 s in CI and on a 2-vCPU machine.
- 4.2 `test-budget.mjs` in CI. Check: lowering the limit to 0.1 s makes CI fail.

### Task 5 — Automated review (blocking on high/critical)
- 5.1 Executor proposes the reviewer (no new long-lived secret); Shaked approves.
- 5.2 Add it on every PR, reporting as a check; high/critical fail the check. Check: a seeded PR
  with an obvious injection bug fails; a docs-only PR passes. Shaked marks it required.

### Task 6 — Light theme and friendlier UI
- 6.1 Tokens: move all colors to CSS variables, no visual change. Check: no hex colors outside the token block; `App.css` shorter.
- 6.2 Light theme as default + Light/Dark/System setting. Check: first visit renders light; setting survives reload; unit test for the setting.
- 6.3 Screen-by-screen redesign: login, draft list, editor/composer, preview, share pages, tokens page. Check per screen: Shaked approves on the preview; AA contrast in both themes; touch targets ≥ 44 px; E2E passes.

### Task 7 — Keyless auth (starts after Shaked confirms the agent option)
- 7.1 GitHub Actions OIDC accepted by the API for the smoke user; smoke workflow uses it. Check: deployed smoke 16/16 on preview with no `XT_SMOKE_TOKEN`; then production (asking first). Shaked deletes both smoke secrets.
- 7.2 Bypass secret: Shaked decides (disable preview protection or rotate). Check: smoke passes; secret deleted or rotated.
- 7.3 Short-lived access tokens + rotating refresh tokens (DB migration, server, `/settings/tokens` revoke). Check: access token rejected after 1 h; refresh rotates; reused refresh token revokes the chain.
- 7.4 OAuth authorization server endpoints (metadata, client registration, authorize via GitHub, token). Check: API tests for each; PKCE required.
- 7.5 `/api/mcp` server with tools mirroring the API. Check: a fresh MCP client connects after one approval and lists drafts; no token copied by hand.
- 7.6 Device flow mints the same pair; docs, `/llms.txt` and OpenAPI updated. Check: `npm run agent:login` works with no hand-made token; smoke passes.
- 7.7 One release later: remove hand-made `xt_` tokens. Check: no code path creates them.

## Open items for Shaked (outside the tasks)
1. Remove `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel → Settings → Environment Variables.
2. Retire Supabase on or after 2026-11-21, then ask for Task 1.2.
3. Rotate the Vercel automation bypass value pasted in chat during setup; update `VERCEL_AUTOMATION_BYPASS_SECRET`.
4. Phase 4 manual UI checks on the preview.
5. Confirm the agent auth option (A).
