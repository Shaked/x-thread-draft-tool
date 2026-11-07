# Plan: Keyless agent auth, automated reviews, and code quality gates

Status: **Planned, not started.** Starts after the Supabase migration is finished and Supabase is retired (Phase 4 in [vercel-migration.md](./vercel-migration.md)).
Owner: Shaked (decisions), executor (implementation).

## Goal

1. **No long-lived secrets for GitHub or agents.** Agents and CI get short-lived credentials
   automatically, the way a connector works: no token to create or paste by hand.
2. **Security and code review run on every pull request** without a human starting them.
3. **Code stays small and clean**: dead code and duplicate code are caught, and generated or
   "slop" code is flagged.
4. **Tests stay fast**: each test file finishes in a few seconds, so the feedback loop stays tight.

## Current baseline (measured 2026-11-07)

| Item | Now | Target |
|---|---|---|
| Agent credential | Hand-made `xt_` API token (created in the web UI, copied into a secret) | Automatic short-lived credential (see A) |
| CI secrets for GitHub | `XT_SMOKE_TOKEN`, `XT_SMOKE_TOKEN_PRODUCTION`, `VERCEL_AUTOMATION_BYPASS_SECRET`, `DATABASE_URL_UNPOOLED`, `BLOB_READ_WRITE_TOKEN`, `SUPABASE_*`, `BACKUP_PASSPHRASE` | OIDC where the provider supports it; the rest removed |
| Security scanning | None in CI. `npm audit`: 39 vulnerabilities (3 critical, 20 high) | CodeQL + dependency review + audit gate on PRs |
| Automated code review | Manual review only (Codex bot comments, not required) | Automated review step on every PR, findings reported |
| Dead code / duplicates | None | `knip` (unused files and exports), duplicate-code check |
| Test time | Unit + API suite about 19 s total; PGlite starts once per file | Every test file under 3 s; suite under 30 s |
| Slop | None | Scan for placeholder text, commented-out code, repeated boilerplate |

## A. Keyless (OIDC) authentication

**GitHub Actions to Vercel and Neon/Blob:**
- Use GitHub OIDC (`permissions: id-token: write`) where the provider accepts it. Vercel supports OIDC federation for deployments; check which of Neon and Blob accept it before relying on it.
- Anything without OIDC support stays a secret, but only one per provider, scoped to the minimum, and rotated on a schedule.
- Remove `VERCEL_AUTOMATION_BYPASS_SECRET` by disabling Deployment Protection on previews, or move it to OIDC if the platform allows.

**Agents (Claude, Codex, other connectors):**
- Goal: an agent gets access the way a connector does. The user approves once, the agent receives a short-lived credential, and it refreshes automatically.
- Design options to decide before building: (a) GitHub OAuth Device Flow with refresh tokens stored server-side, so the agent never sees a long-lived token; (b) an MCP server that holds the user's session and exposes the API as tools; (c) OIDC from the agent platform to this API, trusting specific issuers and subjects.
- Decision needed from Shaked: which option. Recommendation: (a) for the API now, then (b) as the connector surface.
- Acceptance: a new agent session can call the API after one approval, with no token copied by hand, and the credential expires within an hour.

## B. Automated security and code review on every PR

- **CodeQL** (JavaScript) on push and pull request.
- **Dependency review** on pull requests (blocks new high or critical vulnerabilities), plus `npm audit --omit=dev --audit-level=high` as a gate. Clear the current 3 critical findings first.
- **Secret scanning** (GitHub secret scanning plus a pre-commit hook using `gitleaks`).
- **Automated code review**: a review step on every PR that reports findings as a check. Findings are advisory until the team agrees on a severity threshold.
- Every automated tool posts a result the PR checks can require; none is run only by hand.

## C. Clean code, code reduction, slop

- **Lint**: ESLint with rules for unused code, complexity limits, and no `console.log` in server code. Add `eslint` to CI; the repo has no linter today.
- **Dead code**: `knip` in CI. It fails on unused files, exports, and dependencies.
- **Duplicates**: a duplicate-code check (`jscpd`) with a threshold, run in CI.
- **Slop scan**: a check that fails on placeholder text (`TODO`, `FIXME`, `lorem`, `XXX`), commented-out code blocks, and empty catch blocks, unless a line-level exception is written.
- **Code reduction**: each change must not add more lines than it removes unless it adds a test or a feature the plan names. Reviewed as part of section B.

## D. Test time budget

- Each test file must finish in **3 seconds or less**; the whole unit + API suite in **30 seconds or less**.
- Measure with `vitest --reporter=verbose` and fail CI when a file exceeds the budget (vitest `slowTestThreshold`, plus a small script that reads the JSON report).
- Fixes, in order: share one PGlite instance per file (already done for most files), move cold setup into `beforeAll`, and split the slow file.
- The current slowest files are the API suites at about 2–3 s each (PGlite startup); measure before changing.

## Order of work

1. Finish Phase 4 (production smoke test, remove `VITE_SUPABASE_*`, retire Supabase at 14 days).
2. Remove the secrets that are no longer needed (Supabase, backup passphrase, bypass secret if Deployment Protection is disabled).
3. Section B (security and dependency gates) and section C lint and dead-code checks: these catch the most risk for the least work.
4. Section D time budget.
5. Section A (OIDC and agent auth). Starts with a design decision from Shaked.
6. Automated review step (B) last, once the gates are stable, so review comments are not noise.

## Decisions needed from Shaked

- Agent auth option: (a), (b), or (c) in section A.
- Automated review: which tool or model runs it, and whether its findings block merges or only comment.
- Whether `npm audit` critical findings must be fixed before this plan starts, or are tracked as a separate item.
