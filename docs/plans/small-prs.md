# Plan: Small pull requests (≤ 100 changed lines), verified splits, deterministic gates

Status: **Draft for Shaked's decisions (2026-11-08). Not started.**
Owner: Shaked (decisions, repository settings, merges). Executor: an agent, one task per PR,
following [How to execute](./post-migration-hardening.md#how-to-execute-this-plan).

## Goal

1. Every pull request into `main` changes **at most 100 lines**.
2. Bigger work is built in full first, then **split into a stack of PRs**, and the split is
   proven in a clean temporary worktree **before any PR is opened**: every part builds, passes
   every test, merges into `main` without conflicts, and the parts together equal the full work.
3. Every rule is enforced by a program (Claude Code hooks, git hooks, CI, branch protection),
   never by an agent remembering it. The same input always gives the same verdict.
4. Each part is safe to ship on its own: `main` deploys to production after every merge.

## Enforcement layers (and why each one alone is not enough)

| Layer | Runs | Catches | Bypassed by |
|---|---|---|---|
| Claude Code hooks (`.claude/settings.json`) | Before an agent tool call | Agent mistakes early: `--no-verify`, pushing a work branch, opening an unverified PR | Shell indirection (`eval`, scripts), humans, other agents |
| Git hooks (`.githooks/`) | `git commit`, `git push` | Size, tests, secrets before code leaves the machine | `--no-verify`, `core.hooksPath` unset (**it is unset in fresh cloud clones today**), GitHub MCP file writes |
| CI on `pull_request_target` | On GitHub | Everything, from `main`'s copy of the rules | Nothing, once required in branch protection |
| Branch protection / ruleset on `main` | Merge button | Red or missing checks, out-of-date branches | Admin override (Shaked only) |

**Only the last two are gates.** Hooks give fast feedback and keep agents on the path; CI is
the source of truth. Every hook calls the same script CI calls, so local and CI verdicts match.

## Rules (the contract)

### R1. What counts as a changed line
- `added + deleted` from `git diff --numstat -M origin/main...HEAD` (merge base, rename
  detection on, so a moved file costs only its edited lines). Whitespace changes count.
- Excluded, from a fixed list in `.github/pr-size.json` (read **from `main`**, never from the PR):
  - `package-lock.json`, only when `package.json` changes in the same PR;
  - the auto-generated block of `claude.md` (between the `AUTO-INDEX` markers);
  - the PR's single new `docs/changelogs/*.md` file, when ≤ 15 lines.
- Anti-gaming: a binary file counts 25 lines; an added line longer than 200 characters counts
  `ceil(length / 100)` lines; minified or generated files outside the list count in full.
- **Decision D1** below: tests count or not.

### R2. Exceptions
- None by label or PR text: an agent acting with Shaked's GitHub identity can add both.
- The only escape hatch is Shaked changing `.github/pr-size.json` on `main` in its own PR, or an
  admin merge. Both leave a visible trail.

### R3. Stacks
- A part's branch is `claude/<slug>/<k>-of-<n>`; its PR title is `<type>: <summary> (k/n)`.
- Part 1 targets `main`. Part k > 1 targets part k − 1's branch and is a **draft** until part
  k − 1 is merged. Its body has `Depends-on: #<PR of part k-1>`.
- CI check `stack-order` fails while a `Depends-on` PR is not merged, so parts cannot merge out
  of order even by accident.
- Merge style for stacks: **merge commit** (decision D2). A squash or rebase merge of part 1
  rewrites its commits, so part 2 then conflicts with `main` (PR #32 was squash-merged; #26–#29
  used merge commits; the repo mixes both today).
- Prefer **independent parts** (each from `main`, disjoint files, mergeable in any order) over
  a stack when the work allows it. The verifier proves pairwise independence.

### R4. Each part stands alone
- Builds, lints, passes unit, API, E2E and local smoke tests on its own.
- Ships safely to production: nothing user-visible half-done. New code is unreachable
  (not routed, flag off by default) until the part that wires it in.
- **Security order:** guards land before what they guard. Validation, auth checks and rate
  limits come in the same part as, or an earlier part than, the route or input they protect.
  A part must never open a route, query or upload path whose check sits in a later part.
- **Database order:** expand → code → contract. An additive migration ships in its own part
  before code uses it; removals come in a later, separately planned task (CI already blocks
  destructive SQL).
- No dead code across parts: an export added in part k is used (by code or a test) in part k,
  or the knip gate (hardening Task 3.2) fails the part.

### R5. Determinism
- Rules, limits and the scripts that check them are read from `main` in CI.
- One Node version everywhere: `.nvmrc` = CI's version, `engines` in `package.json`, CI uses
  `node-version-file: .nvmrc`, the verifier refuses to run on another major (today: CI 20,
  this sandbox 22).
- `npm ci` only (never `npm install`) in hooks, the verifier and CI.
- No hidden retries: Playwright `retries: 0` in CI. A flaky test is a bug filed as a plan task,
  never retried into green (today: `retries: 2`).
- Tests do not touch the network or the real clock without a fake; `TZ=UTC` in scripts and CI.
- Generated files are content-only: `npm run docs:refresh` must not write a timestamp (today it
  rewrites `_Last refreshed:` on every commit, so **every two open PRs conflict on `claude.md`**).
- No PR edits a file after it is opened just to record its own number: plan Status lines name
  the task and branch, not `In PR #NN` (today this forces a second commit after each PR, which
  changes the tree that was verified, and every parallel PR edits the same Status lines).

## How the plan breaks, and the fix for each

| # | Attack or failure | Fix |
|---|---|---|
| B1 | Agent commits with `--no-verify`, or hooks never installed in a fresh clone | SessionStart hook sets `core.hooksPath`; PreToolUse denies `--no-verify`, `-n`, `core.hooksPath`; CI gate regardless |
| B2 | Agent writes to GitHub through MCP tools (`push_files`, `create_or_update_file`, `create_pull_request`, `merge_pull_request`, `enable_pr_auto_merge`), skipping git hooks | PreToolUse denies the write tools; `create_pull_request` only after the verify stamp matches (T5) |
| B3 | PR edits the size workflow or config to pass itself | Check runs on `pull_request_target` from `main`'s files; it never checks out or runs PR code |
| B4 | `pull_request_target` injection (PR title or body in `run:`) or a write token used on PR code | Read PR data only through the API in JS; `env:` only; `permissions: contents: read, pull-requests: read`; no checkout of the head |
| B5 | One 5,000-character line, a minified bundle, a binary blob | R1 long-line and binary weights |
| B6 | Lockfile churn without a dependency change | Excluded only with a `package.json` change |
| B7 | Splits that are green alone but conflict with each other or `main` | Verifier runs `git merge-tree --write-tree` for each part against `origin/main` and pairwise for independent parts |
| B8 | Parts together differ from the work that was tested | Verifier asserts `git diff --quiet <work> <last part>` (identical trees) |
| B9 | Part 2 merged before part 1, or squash breaks the stack | `stack-order` check, drafts, merge commits (R3) |
| B10 | `main` moves after verification | Ruleset "require branches to be up to date"; after each merge `scripts/stack.sh restack` merges `main` forward into the next part and re-verifies |
| B11 | Intermediate part ships an unguarded route or half a migration to production | R4 security and database order; the verifier reports routes and migrations per part for review |
| B12 | Mandatory per-PR docs (changelog, Status, feature docs, `claude.md`) eat the budget | R1 exclusions; Status lines stop holding PR numbers; deterministic `claude.md` |
| B13 | Agent forges the verify stamp | The stamp is a convenience for the PR hook only; CI recomputes size, order and tests itself |
| B14 | Splitting into meaningless 1-line PRs to look small | Each part has a one-line purpose in the stack plan and must pass knip (no unused code) |
| B15 | Flaky E2E hides behind retries, or passes locally on Node 22 and fails on 20 | R5 |
| B16 | Agent's GitHub writes carry Shaked's identity, so code-owner review cannot tell them apart | Spike in T0; decide D3 |

## Tasks

One task per PR; each task's own PR obeys the 100-line rule (the size check lands first, in
warn-only mode, so later tasks are measured from day one).

### Task 0 — Spike: identities and settings (no code)
Report to Shaked, then wait: (1) which GitHub identity agent pushes, PRs and labels use
(`Shaked` vs `claude[bot]`); (2) whether the account can use rulesets with required checks and
"require up to date"; (3) whether "automatically delete head branches" is on (GitHub retargets
a stacked PR to `main` only when its base branch is deleted after merge).

### Task 1 — Deterministic docs and status
**Files:** `scripts/update-claude-index.mjs`, `.githooks/pre-commit`, `docs/plans/*.md` Status lines, Rule 5 of the hardening plan.
**Steps:** drop the timestamp from the index; the hook runs `docs:refresh` and fails with
"claude.md is stale, run npm run docs:refresh and stage it" instead of `git add`-ing silently;
Status lines say `In progress on claude/<slug>`.
**Acceptance:** `npm run docs:refresh` twice gives no diff; two branches from the same `main`
that touch different features merge without a `claude.md` conflict (`git merge-tree`).

### Task 2 — Size check script
**Files:** new `scripts/pr-size.mjs`, new `.github/pr-size.json`, new `tests/unit/pr-size.test.js`.
**Steps:** pure `measure(numstat, files, config)` → `{ total, perFile, excluded, verdict }`;
CLI over `git diff --numstat -M <base>...HEAD`, prints the top 5 files. Rules R1.
**Tests:** rename, binary, long line, lockfile with and without `package.json`, changelog cap, `claude.md` block.
**Acceptance:** `node scripts/pr-size.mjs --base origin/main` prints the count for this branch and exits 0 ≤ 100, 1 above.

### Task 3 — CI gates `pr-size` and `stack-order`
**Files:** new `.github/workflows/pr-gates.yml`.
**Steps:** `pull_request_target` (opened, synchronize, reopened, edited); checkout `main` only,
`persist-credentials: false`; pinned actions; reads files and body through the REST API; job
`pr-size` runs `scripts/pr-size.mjs --api`, job `stack-order` parses `Depends-on:`. Warn-only
(`continue-on-error`) for one week of data, then blocking.
**Acceptance:** on its own PR both checks report; a throwaway PR (never merged) editing
`pr-size.json` to `limit: 100000` still gets measured against 100.

### Task 4 — Git hooks: pre-push gate
**Files:** new `.githooks/pre-push`, `.githooks/pre-commit`, `package.json` (`hooks:install`).
**Steps:** pre-push refuses `main`, refuses `work/*` branches, runs `pr-size` against the
stack parent (`git config branch.<b>.stackParent`, default `origin/main`), runs gitleaks when
installed. Pre-commit stays fast (refresh, lint, unit tests) and does **not** check size, so
the full work branch can grow past 100 lines locally.
**Acceptance:** pushing a 101-line branch fails with the count; pushing `work/x` fails.

### Task 5 — Split verifier `scripts/stack.sh`
**Files:** new `scripts/stack.sh`, new `tests/unit/stack.test.js` (runs it on a temp git repo), `.claude/skills/agent-pr-workflow.md`.
**Commands:**
- `verify <work-branch> <part-1> … <part-n>`: for each part, in a fresh
  `git worktree add <scratch>/verify-<k>`: `npm ci`, `precommit:checks`, `test:e2e`, local
  smoke; `pr-size` against its parent; `git merge-tree --write-tree origin/main <part>` clean;
  ancestry part k − 1 ⊂ part k; last part's tree == work branch's tree. For independent parts,
  pairwise `merge-tree`. Prints a table and writes `.git/stack-verified/<part>` = tree SHA.
- `restack`: after a part merges, merge `origin/main` into the next part, re-run `verify`.
- `prs`: prints titles, bases, `Depends-on` lines and draft flags for opening the PRs.
**Acceptance:** on a demo 250-line change split into 3 parts the verifier passes; moving a hunk
from part 2 to part 3 so part 2 no longer builds makes it fail at part 2; editing the work
branch after the split makes the tree check fail.

### Task 6 — Claude Code hooks
**Files:** `.claude/settings.json`, new `.claude/hooks/guard-bash.mjs`, `.claude/hooks/guard-github.mjs`, `.claude/hooks/session-start.sh`, tests for both guards.
- `SessionStart`: `git config core.hooksPath .githooks`; `npm ci` when `node_modules` is missing; warn when Node major ≠ `.nvmrc`.
- `PreToolUse` `Bash`: deny `--no-verify`, `commit -n`, `core.hooksPath`, `push --force` (allow
  `--force-with-lease` only on `claude/*`), push to `main` or `work/*`, `gh pr merge`.
- `PreToolUse` `mcp__github__.*`: deny `push_files`, `create_or_update_file`, `delete_file`,
  `merge_pull_request`, `enable_pr_auto_merge`, `pull_request_review_write` approve; allow
  `create_pull_request` only when `.git/stack-verified/<head>` equals the head's tree SHA and
  the diff is ≤ 100 lines (else the message says to run `scripts/stack.sh verify`).
- `PreToolUse` `Edit|Write` on `.githooks/**`, `.github/**`, `.claude/settings.json`,
  `.claude/hooks/**`: `ask` (these change the rules; a person confirms).
- `Stop`: block the end of a turn while the current `claude/*` branch has unpushed commits or is over 100 lines.
**Acceptance:** each guard's unit test covers allow and deny cases; in a session,
`git commit --no-verify` is refused with the reason.

### Task 7 — Determinism fixes
**Files:** `.nvmrc`, `package.json` `engines`, `.github/workflows/*.yml` (`node-version-file`), `playwright.config.ts` (`retries: 0`), test scripts (`TZ=UTC`).
**Acceptance:** CI green with retries off three runs in a row (record durations); a flaky test
found here becomes its own plan task.

### Task 8 — Shaked: repository settings
Ruleset on `main`: require PRs, required checks (existing + `pr-size`, `stack-order`), require
up to date, block force pushes and deletions, allow merge commits (D2), auto-delete head
branches. Codeowners for `.github/`, `.githooks/`, `.claude/`, `scripts/pr-size.mjs`,
`scripts/stack.sh` if D3 allows it.

## Order of work
Task 0 → 1 → 2 → 3 (warn-only) → 4 → 5 → 6 → 7 → 3 blocking → 8. Hardening Tasks 2 (security
gates) and 3.2 (knip) make R4 stronger; do them before Task 3 turns blocking if possible.

## Decisions for Shaked

| # | Question | Recommendation |
|---|---|---|
| D1 | Do tests count toward 100? | **Count them.** Honest size; 100 lines of code plus tests is already a full review. Revisit with Task 3's week of data. |
| D2 | Merge style | **Merge commits only** (stacks survive; matches #26–#29). |
| D3 | Code-owner review on rule files | Only if Task 0 shows agent writes use a separate identity; otherwise rely on `ask` hooks plus Shaked's review. |
| D4 | Size check warn-only period | One week, then blocking. |
| D5 | This plan document is itself > 100 lines | Accept as one docs PR before the rule exists, or split it into Rules / Breaks / Tasks parts. |
