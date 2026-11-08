# Plan: Small pull requests (≤ 100 changed lines), no shared files, deterministic gates

Status: **Draft v2 (2026-11-08), reviewed by a second agent. Waiting for Shaked's decisions D1–D4.**
Owner: Shaked (decisions, repository settings, merges).
Executor: **Claude Haiku in a follow-up session**, one task per PR, only the task Shaked names.

## Goal
1. Every pull request into `main` changes **at most 100 lines** (counting rules in R1).
2. Bigger work is built in full first, split into parts, and the split is proven in temporary
   worktrees **before any PR is opened**: each part builds, passes every test, merges into
   `main` cleanly, and the parts together equal the full work.
3. **No PR edits a shared file just to record itself** (changelog, README notes, plan status,
   index). Each PR adds one new fragment file named by its slug.
4. Every rule is checked by a program (Claude Code hooks, git hooks, CI, repository ruleset).
   The same input gives the same verdict locally and in CI.
5. Each part is safe in production on its own (`main` deploys after every merge).

---

## Executor rules (read before every task)

1. Do only the task Shaked named. Start with `scripts/agent-pr.sh branch claude/small-prs-<task-number>-<slug>`.
2. The task's own diff must be ≤ 100 lines: `git diff --numstat origin/main...HEAD | awk '{a+=$1+$2} END {print a}'`
   (until Task 6 exists; after that use `node scripts/pr-size.mjs`). Over 100 → stop and ask.
3. Never test against real GitHub. Git behaviour is tested in a temp repo with a local bare
   remote (`git init --bare <tmp>/remote.git`), created inside the test with `mkdtemp`.
4. Use the exact file names, flags and messages written in the task. Do not rename them.
5. Before committing: `npm run precommit:checks` passes. Never use `--no-verify`.
6. Open the PR with `mcp__github__create_pull_request` (base `main`). Paste every acceptance
   command and its output into the PR body.
7. **Stop and ask Shaked** (one message, then wait) when: a command fails twice for the same
   reason; `node -v` major ≠ `.nvmrc` (after Task 1); `git --version` < 2.38; the task needs a
   file not listed under **Files**; the task needs a GitHub setting or secret; an acceptance
   line cannot pass.

---

## Rules (the contract the tasks build)

### R1. What counts as a changed line
- Source: `git diff -z --numstat -M50% --no-ext-diff --no-textconv <merge-base>...<head>`.
  `-z` makes renames print as `old\0new\0` (never `a/{x => y}`). Rename detection means a moved
  file costs only its edited lines.
- `added + deleted` per file, summed. Whitespace counts.
- A **deleted file** counts **1** line (removing code is cheap to review).
- A **binary** file counts **25** lines. Binary = numstat prints `-\t-` **or** the blob contains a
  NUL byte in its first 8000 bytes (checked with `git cat-file`; a PR's `.gitattributes` must not
  be able to hide text as binary).
- An **added line over 200 characters** counts `ceil(length / 100)` lines.
- `package-lock.json` counts **0** only when `package.json` also changes; otherwise in full.
- Nothing else is excluded. Fragments (R3) count like any file; they are about 5 lines.
- Limit and weights live in `.github/pr-size.json`. CI always reads it from `main`.

### R2. No exceptions by label or PR text
Agent actions use Shaked's GitHub identity, so a label or PR body proves nothing. The only
escape hatches are a PR to `main` that changes `.github/pr-size.json` (reviewed by Shaked), or
an admin merge. Both leave a trail.

### R3. Fragments instead of shared files
- Each PR adds exactly **one** file `docs/changelog.d/<slug>.md`, where `<slug>` is the branch
  name after the last `/` (branch `claude/small-prs-4-fragments` → `small-prs-4-fragments.md`).
- Format (≤ 15 lines):
  ```
  ---
  plan: small-prs          # file name in docs/plans/ without .md, or "none"
  task: "4"                # task id in that plan, or "none"
  status: done             # done | partial (partial = one part of a split; see R4)
  readme: false            # true when README.md must change for users (Shaked folds it in)
  ---
  One to five lines: what changed and why, for people.
  ```
- A PR **must not** modify or delete any other file in `docs/changelog.d/`.
- `docs/changelogs/` (old timestamped files) stays as history; no new files go there.
- **Plan status is computed, never written:** `npm run plan:status` reads fragments on the
  checked-out tree and prints `plan task status` lines. "In progress" = an open PR; Shaked or
  an agent looks that up on GitHub. Plan files lose their `Status:` lines (Task 5).
- **Generated output is printed, never committed.** A committed generated file becomes a shared
  file again.
- README: a PR changes `README.md` only when setup or usage changes. When it does, those lines
  count toward 100 like any other.
- `claude.md` loses its auto-generated index (Tasks 2–3). It points at `docs/features/` and
  `.claude/skills/` instead, so adding a feature doc or skill never edits `claude.md`.

### R4. Splitting: one open part at a time, no stacks
- The full work lives on `work/<slug>`. Pushing it is allowed (cloud containers are temporary);
  opening a PR from it is not.
- A **split manifest** `split.txt` on the work branch lists whole files per part:
  ```
  # part 1: add validation helper and its test
  server/validate.js
  tests/api/validate.test.js
  # part 2: use it in the drafts route
  server/routes/drafts.js
  docs/changelog.d/drafts-validation.md
  ```
  Part k = `origin/main` + every file listed in parts 1..k taken whole from the work branch
  (deleted files are deleted). The last part equals the work tree by construction.
  `split.txt` itself is never part of a part.
- Every part's PR targets **`main`**. Only **one part is open at a time**: part k+1 is opened only
  after part k is merged, and only after merging `origin/main` into part k+1's branch.
  Because the size is measured against `main`, part k+1 cannot pass while part k is unmerged, so
  the order enforces itself. There is no `Depends-on`, no PR based on another PR, no retargeting.
- Any merge style is fine (squash included): part k+1 is rebuilt on the new `main` before it opens.
- Each part's fragment uses `status: partial`; the last part uses `status: done`.
- A file that must be split by hunk is an exception: the agent edits the part branch by hand and
  says so in the PR body. The verifier still checks it.
- **Each part is production-safe:**
  - Guards first: validation, auth checks and rate limits come in the same part as the route
    or input they protect, or earlier.
  - Database: expand → code → contract. An additive migration ships before the code that uses it.
  - New code is unreachable (not routed, flag off) until the part that wires it in.
  - No unused exports: code added in part k is used by code or a test in part k.

### R5. Determinism
- One Node major everywhere: `.nvmrc` = `22`, `engines.node` = `>=22 <23`, every workflow uses
  `node-version-file: .nvmrc`. (Node 20 is end-of-life; the sandbox runs 22.)
- `npm ci`, never `npm install`, in hooks, scripts and CI.
- Playwright: `retries: 0`, `trace: 'retain-on-failure'`. A flaky test becomes a plan task.
- Test scripts run with `TZ=UTC`.

---

## Enforcement layers

| Layer | Role | Known gap |
|---|---|---|
| Claude Code hooks | Keep agents on the path; fail closed | Shell indirection (`eval`, scripts) gets around a regex |
| Git hooks | Fast local feedback | `--no-verify`; not installed until `npm ci` runs `prepare` |
| CI `pull_request_target` on `main` | **Gate**: runs `main`'s scripts on the PR's commits, never runs PR code | Protects only PRs whose base is `main` (R4 makes that every PR) |
| Ruleset on `main` | **Gate**: required checks, up to date, no force push | Admin can override (Shaked only) |

### Why `pull_request_target` is safe here
- It runs the workflow and scripts from `main`.
- It checks out `main` with `persist-credentials: false`, then runs `git fetch origin +refs/pull/<n>/head:pr`.
- It runs only `node scripts/pr-size.mjs` and `node scripts/changes.mjs`, which use Node built-ins and read git objects. No `npm ci` and no PR code ever run.
- `permissions: contents: read, pull-requests: read`.
- PR title and body are never used.

---

## Tasks (each ≤ 100 changed lines; do them in order)

### Task 0 — Read-only facts (no code, no PR)
Run and report the output to Shaked, then wait:
- `mcp__github__get_me` → login. The latest PR's `user.login` (`mcp__github__list_pull_requests`, state all, 1 item) → who agents act as.
- `mcp__github__get_file_contents` is not enough for settings; ask Shaked for: repo private or
  public, plan (rulesets on a private repo need GitHub Pro), `delete_branch_on_merge`,
  allowed merge styles.
- `git --version`, `node -v`, `npx playwright --version`, and whether `npm run test:e2e` passes here.

### Task 1 — Node 22 everywhere
**Files:** new `.nvmrc`, `package.json`, `.github/workflows/{tests,smoke-deployed,ui-image-upload,data-migrate}.yml`.
**Steps:** `.nvmrc` contains `22`. `package.json` gets `"engines": { "node": ">=22 <23" }`. In each
workflow replace `node-version: 20` with `node-version-file: .nvmrc` (5 places).
**Acceptance:** `grep -rn "node-version: 20" .github/` prints nothing; CI green on the PR.
**Stop if:** a test fails only on 22.

### Task 2 — Remove the auto-index from `claude.md`
**Files:** `claude.md`, `package.json`, `.githooks/pre-commit`.
**Steps:**
1. In `claude.md`, replace everything from `<!-- AUTO-INDEX:START -->` to `<!-- AUTO-INDEX:END -->` with:
   `Feature docs: every file in docs/features/. Skills: every file in .claude/skills/. Read the ones that match your task.`
2. In `package.json`, `precommit:checks` becomes `npm run lint && npm run test:unit`; delete the `docs:refresh` script.
3. In `.githooks/pre-commit`, delete the comment line and the `git add claude.md` line.
4. In `claude.md` "Required docs updates", delete step 5 (docs refresh).
**Acceptance:** `grep -rn "docs:refresh\|AUTO-INDEX" --exclude-dir=node_modules --exclude-dir=docs .` prints nothing.

### Task 3 — Delete `scripts/update-claude-index.mjs`
**Files:** that file; any line in `.claude/skills/*.md` or `docs/` (except `docs/changelogs/`, `docs/plans/`) that mentions it.
**Acceptance:** `grep -rn "update-claude-index" --exclude-dir=node_modules . | grep -v "docs/changelogs\|docs/plans"` prints nothing.

### Task 4 — Fragments: folder and checker
**Files:** new `docs/changelog.d/README.md` (the R3 format), new `scripts/changes.mjs`, new `tests/unit/changes.test.js`, `package.json`.
**Steps:**
1. `scripts/changes.mjs` exports `checkDiff(entries, readFile)`, where `entries` is a list of `{ status, path }` from `git diff --name-status -z <base>...<head>`. It returns a list of error strings (empty = pass). Rules:
   - exactly one `A` under `docs/changelog.d/` other than `README.md`;
   - no `M`, `D` or `R` under `docs/changelog.d/`;
   - the file is ≤ 15 lines;
   - the front matter has `plan`, `task`, `status` ∈ {done, partial} and `readme` ∈ {true, false}.
   Use Node built-ins only (no YAML library): parse `key: value` lines between the two `---` lines.
2. CLI: `node scripts/changes.mjs check --base <ref> --head <ref>` prints each error and exits 1, or prints `fragments: ok` and exits 0.
3. Script `"changes:check": "node scripts/changes.mjs check --base origin/main --head HEAD"`.
**Tests:** one case each for: ok; no fragment; two fragments; edits another fragment; 16 lines; bad status.
**Acceptance:** `npx vitest run tests/unit/changes.test.js` passes. `npm run changes:check` prints `fragments: ok` on this task's own branch (it adds its own fragment).

### Task 5 — Computed plan status
**Files:** `scripts/changes.mjs`, `tests/unit/changes.test.js`, `package.json`, the `Status:` lines in `docs/plans/*.md`, Rule 5 of `docs/plans/post-migration-hardening.md`, `claude.md` changelog section, `docs/changelogs/README.md`.
**Steps:**
1. Add `status(files)` and the CLI `node scripts/changes.mjs status`, which prints `plan<TAB>task<TAB>status` sorted by plan, then task, for every fragment. Script `"plan:status"`.
2. Delete every line starting with `Status:` in `docs/plans/*.md`. If deleting lines would push the diff over 100, delete them only in `post-migration-hardening.md` and `small-prs.md` and stop.
3. Hardening Rule 5 becomes: "Every PR adds one fragment `docs/changelog.d/<slug>.md` (see its README). Never edit Status lines; run `npm run plan:status`."
4. In `claude.md` and `docs/changelogs/README.md`, point to `docs/changelog.d/README.md` instead of the timestamp naming.
**Acceptance:** `npm run plan:status` prints this task's own line `small-prs 5 done`.

### Task 6 — `pr-size`: the measuring function
**Files:** new `scripts/pr-size.mjs` (pure functions only), new `tests/unit/pr-size.test.js`.
**Steps:** export `parseNumstatZ(buffer)` → list of `{ added, deleted, path, oldPath, binary }`, and `measure(files, { addedLines, isNul, config })` → `{ total, perFile, verdict }`, following R1 exactly.
**Tests:** a plain edit; a rename with edits (`-z` form); a deleted file = 1; binary `-\t-` = 25; a text file whose blob has a NUL = 25; one 450-character line = 5; lockfile with and without `package.json`; total 100 → pass, 101 → fail.
**Acceptance:** `npx vitest run tests/unit/pr-size.test.js` passes.

### Task 7 — `pr-size`: CLI and config
**Files:** `scripts/pr-size.mjs`, new `.github/pr-size.json`, `tests/unit/pr-size.test.js`, `package.json`.
**Steps:**
1. `.github/pr-size.json`: `{ "limit": 100, "binary": 25, "longLine": 200, "deletedFile": 1 }`.
2. CLI `node scripts/pr-size.mjs --base <ref> --head <ref> [--config <path>]`. It computes the merge base and runs the R1 git command with `execFileSync` (array arguments, never a shell string). It reads added lines from `git diff -U0` and prints the total plus the 5 biggest files, then `pr-size: ok (N/100)` or `pr-size: too big (N/100)`. It exits 0 or 1.
3. Script `"pr-size": "node scripts/pr-size.mjs --base origin/main --head HEAD"`.
**Tests:** a temp repo (`mkdtemp`, `git init`) with commits for 100 and 101 lines.
**Acceptance:** `npm run pr-size` prints `pr-size: ok` for this branch.

### Task 8 — CI gate workflow (warn-only)
**Files:** new `.github/workflows/pr-gates.yml`.
**Steps:**
- `on: pull_request_target: types: [opened, synchronize, reopened]`, `branches: [main]`.
- Top-level `permissions: contents: read, pull-requests: read`.
- Two jobs, `pr-size` and `fragments`, each with `continue-on-error: true` (warn-only; D3).
- Steps:
  1. `actions/checkout` pinned by SHA (hardening Rule 9), `ref: main`, `persist-credentials: false`, `fetch-depth: 0`.
  2. `git fetch origin +refs/pull/${{ github.event.pull_request.number }}/head:pr` (the number is an integer, safe to interpolate).
  3. `actions/setup-node` with `node-version-file: .nvmrc`.
  4. `node scripts/pr-size.mjs --base origin/main --head pr` (or `changes.mjs check`).
- No `npm ci`. No PR title or body anywhere.
**Acceptance:** both jobs run on this PR and print their verdict lines. A unit test or review cannot prove "PR edits to the config are ignored"; Shaked checks that once on a throwaway PR (Task 15).

### Task 9 — Playwright determinism
**Files:** `playwright.config.ts`, `package.json` (`TZ=UTC` in `test`, `test:unit`, `test:api`, `test:e2e`).
**Steps:** `retries: 0`, `trace: 'retain-on-failure'`.
**Acceptance:** CI green three runs in a row (re-run the workflow); paste the durations. A failure → stop and report it as a flaky test.

### Task 10 — `split.mjs build`
**Files:** new `scripts/split.mjs`, new `tests/unit/split.test.js`.
**Steps:**
- `parseManifest(text)` → list of `{ title, paths }`.
- CLI `node scripts/split.mjs build <work-branch> <slug>`. For k = 1..n it creates branch `claude/<slug>-<k>-of-<n>` from `origin/main`. It then runs `git checkout <work-branch> -- <paths of parts 1..k>`, plus `git rm` for paths deleted on the work branch, and commits `<title> (k/n)`.
- It refuses to run when a manifest path doesn't differ between `origin/main` and the work branch.
- It refuses when a changed file on the work branch is missing from the manifest (other than `split.txt`).
- All git calls use `execFileSync` with array arguments.
**Tests:** a temp repo; a 3-part manifest; the last part's tree equals the work tree (`git rev-parse <b>^{tree}`); a missing path fails.
**Acceptance:** `npx vitest run tests/unit/split.test.js` passes.

### Task 11 — `split.mjs verify`
**Files:** `scripts/split.mjs`, `tests/unit/split.test.js`, `package.json` (`"split": "node scripts/split.mjs"`).
**Steps:** `verify <work-branch> <slug>` checks, for each part k:
1. `git worktree add <scratchpad or os.tmpdir()>/verify-<slug>-<k> <part branch>`;
2. in that worktree: `npm ci`, `npm run precommit:checks`, `npm run test:e2e`;
3. the size of the **cumulative** diff `origin/main...part k` minus part k−1: each part ≤ 100 (R1 via `measure`);
4. `git merge-tree --write-tree origin/main <part k>` exits 0;
5. part n's tree == work branch tree;
6. `git worktree remove --force` in a `finally` block.

It prints one line per part, `part k/n: size N, merge ok, tests ok`. Then it writes `<git rev-parse --git-common-dir>/split-verified/<branch>` containing the tree SHA. The record is a hint for the PR hook, not a gate.
**Tests:** the temp repo from Task 10 with `--skip-tests` (a flag for tests only) covering size and merge failure.
**Acceptance:** tests pass; running `verify` on a real 2-part demo split prints two `ok` lines (paste them).

### Task 12 — Claude hook: Bash guard
**Files:** new `.claude/hooks/guard-bash.mjs`, new `tests/unit/guard-bash.test.js`.
**Contract:** it reads hook JSON on stdin and looks at `tool_input.command`. To deny, it prints
`{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"<reason>"}}`
and exits 0. Otherwise it prints nothing and exits 0. The whole body sits in `try`/`catch`; on any error it denies with the reason `guard error: <message>` (**fail closed**: a crash must never allow the call).
**Deny when the command contains:**

| Pattern | Reason |
|---|---|
| `--no-verify`, or `git commit` with `-n` | hooks are required |
| `core.hooksPath` (also `git -c core.hooksPath=`) | hooks are required |
| `push --force` or `push -f` without `--force-with-lease` | use --force-with-lease on claude/* only |
| `push` with `main` or `HEAD:main` as the target | open a PR instead |
| `gh pr merge`, `gh pr create`, `gh api` with `pulls` | use the MCP PR tools after split verify |
| `curl` with `api.github.com` | use the MCP tools |

**Tests:** one allow and one deny per row, plus invalid JSON on stdin → deny.
**Acceptance:** `npx vitest run tests/unit/guard-bash.test.js` passes.

### Task 13 — Claude hook: GitHub tools guard
**Files:** new `.claude/hooks/guard-github.mjs`, new `tests/unit/guard-github.test.js`.
**Contract:** the same output and fail-closed rules as Task 12. It applies to any `tool_name` matching `^mcp__.*github.*__`. **Deny by default.** Allow:
- names starting with `get_`, `list_`, `search_`, or `pull_request_read`, `issue_read`;
- `add_issue_comment`, `add_reply_to_pull_request_comment`, `update_pull_request` (only when `tool_input` has no `base` and no `state`);
- `create_pull_request` only when **all** of these hold:
  - `tool_input.base` is `main`;
  - `tool_input.head` does not start with `work/`;
  - `node scripts/pr-size.mjs --base origin/main --head <sha>` exits 0, where `<sha>` comes from `git ls-remote origin refs/heads/<head>` (the pushed branch, not local HEAD);
  - when the head branch name ends in `-<k>-of-<n>` (a split part), `<git common dir>/split-verified/<head>` exists and equals `git rev-parse <sha>^{tree}`.

Everything else (`push_files`, `create_or_update_file`, `delete_file`, `merge_pull_request`, `enable_pr_auto_merge`, `pull_request_review_write`, `create_branch`, `actions_run_trigger`, `fork_repository`, …) is denied with "not allowed for agents; ask Shaked".
**Tests:** the allowed read tools; `create_pull_request` ok and too big (temp repo as `origin`); `push_files` denied; a crash → deny.
**Acceptance:** `npx vitest run tests/unit/guard-github.test.js` passes.

### Task 14 — Wire the hooks, plus git pre-push
**Files:** new `.claude/settings.json`, new `.claude/hooks/stop-check.mjs`, new `.githooks/pre-push`, new `tests/unit/stop-check.test.js`.
**Steps:**
- `PreToolUse` with matcher `Bash` → `node .claude/hooks/guard-bash.mjs`; matcher `mcp__.*github.*` → `node .claude/hooks/guard-github.mjs`.
- `SessionStart` → `git config core.hooksPath .githooks` only (it must be idempotent and fast; it runs again on resume and compact). Installing dependencies belongs in the environment setup script, not here.
- `Stop` → `stop-check.mjs`:
  - if the stdin JSON has `stop_hook_active: true`, exit 0;
  - if the current branch matches `claude/*` and has commits not on its upstream, print `{"decision":"block","reason":"push your branch first"}`;
  - `work/*` branches are never blocked.
- `.githooks/pre-push` (POSIX sh) reads `<local ref> <local sha> <remote ref> <remote sha>` lines from stdin:
  - refuse `refs/heads/main`;
  - for `refs/heads/claude/*`, run `node scripts/pr-size.mjs --base origin/main --head <local sha>` and refuse on exit 1;
  - allow `work/*`.

**Note:** hooks load when a session starts, so test them with the unit tests and a temp repo, not by expecting this session to change.
**Acceptance:** the unit tests pass. In a temp repo with the hook installed, `git push` of a 101-line `claude/x` branch to a bare remote fails with `pr-size: too big`.

### Task 15 — Workflow skill and Shaked's settings
**Files:** `.claude/skills/agent-pr-workflow.md`, `scripts/agent-pr.sh` (remove `pr` and `checks`, which need `gh api`, blocked in cloud sessions).
**Steps:** the skill describes the R4 recipe: work branch → `split.txt` → `npm run split build` → `npm run split verify` → open part 1 with `mcp__github__create_pull_request` → after merge, `git merge origin/main` into part 2 → open part 2.
**Shaked, then:**
- Ruleset on `main`: require a PR, require the checks `pr-size`, `fragments` and the existing test jobs, require branches up to date, block force pushes and deletions, no bypass except admin.
- Remove `continue-on-error` from `pr-gates.yml` (a ≤ 5-line PR).
- Once: open a throwaway PR that sets `limit` to 100000 in `pr-size.json` plus 150 other lines, confirm `pr-size` still fails, then close it unmerged.

---

## How the plan breaks, and the fix for each

| # | Attack or failure | Fix |
|---|---|---|
| B1 | `--no-verify`, or hooks not installed | Bash guard (T12), SessionStart `hooksPath` (T14), CI regardless |
| B2 | Agent writes to GitHub through MCP tools and skips git hooks | Deny-by-default GitHub guard (T13) |
| B3 | PR edits the gate workflow or config to pass itself | `pull_request_target` runs `main`'s files (T8); all PRs target `main` (R4) |
| B4 | Code injection through `pull_request_target` | No PR code runs, no `npm ci`, no PR text used, read-only token (T8) |
| B5 | Huge single lines, binary blobs, `.gitattributes` tricks | R1 weights and NUL check |
| B6 | Lockfile churn | Free only with a `package.json` change |
| B7 | Parts green alone but broken together | Cumulative parts: part k is main + parts 1..k, tested in its own worktree (T11) |
| B8 | Parts don't add up to the tested work | Tree equality at build and verify time (T10, T11) |
| B9 | Parts merged out of order | Only one part open; size measured against `main` refuses an early part k+1 (R4) |
| B10 | `main` moves after verification | Ruleset "up to date"; merge `origin/main` into the next part before opening it |
| B11 | A part ships an unguarded route or half a migration | R4 production-safe rules; Shaked's review |
| B12 | Shared files conflict (`claude.md` index, plan Status, `current.md`) | Fragments (R3), computed status (T5), no index (T2–T3) |
| B13 | Agent forges the verify record | The record is a hint; CI re-measures; tests run in CI |
| B14 | Hook crashes and the tool call goes through | Fail closed: try/catch → deny (T12, T13) |
| B15 | Stop hook loops forever | `stop_hook_active` check (T14) |
| B16 | Flaky tests hidden by retries; Node drift | R5, Tasks 1 and 9 |
| B17 | Regex guards evaded by `eval` or scripts | Accepted: guards are guardrails; CI and ruleset are the gates |
| B18 | Agent identity = Shaked, so code-owner review can't separate them | Accepted for now (D4); Shaked reviews every PR to `main` |

## Decisions for Shaked

| # | Question | Recommendation |
|---|---|---|
| D1 | Do tests count toward 100? | **Yes.** Revisit after a week of `pr-size` data. |
| D2 | Fragment folder name | **`docs/changelog.d/`** (your suggestion). Old `docs/changelogs/` stays as history. |
| D3 | Warn-only period for the gates | One week, then blocking (Task 15). |
| D4 | Separate GitHub identity for agents (a bot account or app) so code owners mean something | Later; not needed for these tasks. |
| D5 | This plan file is over 100 lines | Accept it as one docs PR, since the rule does not exist yet. |
