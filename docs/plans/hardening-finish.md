# Runbook: finish the post-migration hardening, end to end

Runbook state: DONE

Written 2026-11-08 by the planning session. Executor: **one Haiku session (or a chain of them), end to end,
without asking Shaked anything in between.** Advisor: **Opus**, consulted through the Agent tool
(see [P-OPUS](#p-opus-consult-opus-instead-of-asking-shaked)). Source of truth for *what* each task
builds: [post-migration-hardening.md](./post-migration-hardening.md). This file is the source of truth
for *order, decisions, procedures and when a task is done*. Where the two disagree, this file wins.

Task numbers in this file are **Task 20 to Task 42**, so a PR body line such as
`Implements docs/plans/hardening-finish.md Task 24` passes the net-lines rule (hardening Task 3.5).

---

## 0. The Checkpoint: run it again and again

You will lose track if you only read this file once. Nothing reloads this file for you
automatically: the session's starting prompt names it, and the Checkpoint is how you keep it in
view. **Run the Checkpoint.**

**Run the Checkpoint:**
- at the start of every session;
- after every completed procedure step (one PR opened, one merge, one preview round);
- on every wake-up (a PR event, a `send_later` message, a CI notification);
- after any context summary or compaction;
- before every irreversible action (merge, delete, close, force-push);
- after every 15 tool calls without one;
- whenever you are unsure what to do next.

**Checkpoint (C1 to C6):**
1. **C1** Read the [Rules card](#1-rules-card) (section 1) in full.
2. **C2** Read the ledger issue (title `Hardening finish: run ledger`; find it with
   `mcp__github__list_issues`, state open). If it does not exist, you are at Task 20.
3. **C3** Reconcile: for every task the ledger marks `doing` or `waiting`, check the real state on
   GitHub (PR merged? checks? Codex?) and Vercel/Neon, then update the ledger row.
4. **C4** Pick the next task: the first row in the [task index](#3-task-index) whose `Needs` are all
   `done` and whose state is `todo`, `doing` or `waiting` with the condition now met. If the first
   such task is waiting on something that has not happened, take the next independent one.
   If nothing can move, go to [P-WAIT](#p-wait-waiting-without-polling).
5. **C5** Mirror the picked task in your local task list (TaskCreate/TaskUpdate: one task per
   runbook task, the current one `in_progress`).
6. **C6** Read that task's section in full, do its **next unfinished step only**, update the ledger
   row (state, PR number, one-line note), then return to C1.

Every task section starts with **Done when**. If the Done-when lines already hold, mark the task
`done` and move on: re-running a task must never repeat work.

---

## 1. Rules card

<!-- RULES-CARD:START -->
RUNBOOK RULES CARD (docs/plans/hardening-finish.md). Runbook state is DONE: the runbook is finished.
1. Run the Checkpoint (section 0: C1 to C6) at session start, after every step, on every wake, after compaction, before every merge, delete, close or force-push.
2. Never ask Shaked anything. A question goes to Opus (P-OPUS). If Opus says owner-only, park the task, add it to the ledger's Owner actions list, and continue with the next task.
3. The ledger issue "Hardening finish: run ledger" is the memory. Update it after every step.
4. One task per PR. Branch from the latest main. Never commit with --no-verify. Never disable, skip or weaken a test.
5. Merge only via P-MERGE (merge commit, all checks green, Codex P0/P1 handled, stack order). Never approve a PR. Never squash.
6. Never print, paste or commit a secret. Never change GitHub, Vercel or Neon settings. Allowed writes are listed in section 2.4.
7. Never delete a Neon branch that is default, primary, delete-restricted, protected or named main. Only branches listed in Task 21 or picked by the cleanup script may be deleted.
8. Force-push only with --force-with-lease, and only to claude/lucid-sagan-bbciuo (P-PREVIEW) or a claude/* branch this runbook created.
9. GitHub: use the mcp__github__* tools. gh api works only for search. Every comment ends with the attribution footer.
10. No model names in commits, PR text or code.
<!-- RULES-CARD:END -->

---

## 2. Decisions (all made; do not reopen them)

### 2.1 Decisions Shaked made (2026-11-08)

| ID | Decision |
|---|---|
| D-1 | Both production and preview sign-in must work. The fix is two GitHub OAuth Apps, one callback each (an OAuth App has exactly one callback host). Shaked creates the preview app (owner action **O1**). This blocks no task: every preview check in this runbook is automated and needs no human sign-in. |
| D-2 | The executor moves the stable preview itself ([P-PREVIEW](#p-preview-put-a-pr-on-the-stable-preview)). Zero touch from Shaked. |
| D-3 | Per-PR previews stop (Task 22). A PR that needs a live check is put on the stable preview `https://x-thread-draft-tool-preview.vercel.app` whenever the slot is free. |
| D-4 | Production builds are skipped for merges that change only docs, CI or tests (Task 23). |
| D-5 | Neon preview branches are deleted automatically and deterministically: on PR close and in a daily sweep, by the fixed rules in Task 24. |
| D-6 | Delete the 4 Neon preview branches listed in Task 21 now. |
| D-7 | One preview round on the top of the 7.x stack (#53) is the live evidence for 7.5, 7.6 and 7.8. |
| D-8 | `migrate.test.js`: split (already done on #42's branch as `migrate.test.js` + `migrate-rerun.test.js`). If the fresh-database file is still over 3000 ms in CI, give that one file a 5000 ms limit in `scripts/test-budget.mjs` with a comment (Task 31). |
| D-11 | Task 7.9 (#54) is parked. Do not merge it. It blocks nothing. |
| D-12 | #37 (ESLint) and #38 (knip) merge last (Task 38), after one update from main. |
| D-13 | Close #5 (Supabase-era metrics PR, obsolete). Leave #35 (small-PRs plan) open and out of scope. |

### 2.2 Decisions made for Shaked by the planning session (in the spirit of "zero touch")

| ID | Decision |
|---|---|
| D-9 | The deployed smoke test signs in with GitHub OIDC on every environment (Task 26), so the long-lived `XT_SMOKE_TOKEN*` secrets can go. Reason: Goal 1 (no long-lived secrets), and Task 7.9 would make those tokens expire within a week. A temporary fallback to the old secret is removed in Task 27. |
| D-10 | Vercel Authentication on previews is turned off and `VERCEL_AUTOMATION_BYPASS_SECRET` is deleted (owner actions **O2** and **O3**). Reason: its value was pasted in a chat (treat as leaked), the app has its own GitHub sign-in, and it is one more long-lived secret. Task 35 removes the header from the smoke script after O2. |
| D-14 | **The executor merges.** `MERGE_MODE: agent` (line below). Merges follow [P-MERGE](#p-merge-merge-a-pr) exactly. If Shaked changes the line to `MERGE_MODE: owner`, P-MERGE stops at "ready to merge" and records it in the ledger instead. |
| D-15 | The executor posts the `@codex review` comment after each push (Task 5.2 option C wants a person's comment; the executor's comments are posted as Shaked's account). |
| D-16 | 6.3a (#47): Shaked approved the look on the preview (said in chat, 2026-11-08). Record that in a PR comment. No GitHub approval is needed (the PR author is Shaked's account, so GitHub cannot take an approval from it anyway). |
| D-17 | 6.3b, 6.3c and 6.3d: Opus approves the look from screenshots ([P-UI-REVIEW](#p-ui-review-screen-review-by-opus)) against 6.3a's patterns and the 6.3 principles. Shaked may look at the stable preview at any time. Nothing waits for that. |
| D-18 | Preview checks the hardening plan gives to Shaked (login page loads, a draft opens, image upload) count as met when, on the stable deployment of that PR, the `Smoke test` run and the `UI image upload test` run both succeed, and `mcp__Vercel__web_fetch_vercel_url` of `/` returns 200 HTML. |
| D-19 | If a merge turns the production smoke red twice, revert it ([P-PROD](#p-prod-after-a-merge-to-main)). |
| D-20 | Do not edit `post-migration-hardening.md` Status lines in each PR (a shared file, constant conflicts). The ledger holds status. Task 41 updates the hardening plan once at the end. Each PR still adds its own changelog file. |
| D-21 | Overrides of the hardening plan's rules: Rule 1 ("never start a task Shaked has not named"): this runbook names every task. Rule 6 ("never merge"): replaced by D-14 and P-MERGE; "never approve" stays. Rule 10 ("stop and ask Shaked"): replaced by P-OPUS. Rule 2 (`scripts/agent-pr.sh pr` and `checks`): in cloud sessions use the GitHub MCP tools; `gh api` is blocked there except for search. |
| D-22 | The executor never asks for network changes. Deployed checks run in GitHub Actions (read the logs with the MCP tools) or with `mcp__Vercel__web_fetch_vercel_url`. |
| D-23 | 7.6 "add the connector in Claude and approve once" needs a human GitHub sign-in. It becomes optional owner action **O7** after merge. 7.6 merges on its unit tests plus the automated preview checks in Task 34. |
| D-24 | Codex silence: if Codex has not answered 30 minutes after `@codex review`, post it once more; if still nothing 30 minutes later, record `Codex silent` in the ledger and continue as if Codex found nothing. |

MERGE_MODE: agent

### 2.3 Owner actions (Shaked does these whenever convenient; the executor never waits for them except where a task says so)

The executor copies this list into the ledger and ticks a box only when it can verify the action itself.

| ID | Action | Executor verifies by | Blocks |
|---|---|---|---|
| O1 | Create GitHub OAuth App "X Thread Draft Tool (preview)": homepage `https://x-thread-draft-tool-preview.vercel.app`, callback `https://x-thread-draft-tool-preview.vercel.app/api/auth/callback`, enable Device Flow. In Vercel → Settings → Environment Variables, limit the existing `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` to Production and add the new pair for Preview only. Check the production app's callback is `https://x-thread-draft-tool.vercel.app/api/auth/callback`. | `mcp__Vercel__filter_project_envs` shows two `GITHUB_CLIENT_ID` entries, one `["production"]`, one `["preview"]` (never decrypt) | nothing |
| O2 | Vercel → Settings → Deployment Protection → Vercel Authentication: Disabled. | `mcp__Vercel__get_project`: no `ssoProtection` (null) | Task 35 |
| O3 | GitHub → Settings → Secrets and variables → Actions: delete `VERCEL_AUTOMATION_BYPASS_SECRET` (after O2); delete `XT_SMOKE_TOKEN` and `XT_SMOKE_TOKEN_PRODUCTION` (after the ledger says Task 27 is done), and revoke those two tokens on `/settings/tokens`. | cannot verify (no secrets tool); Task 27 removes every use, so leftovers are harmless | nothing |
| O4 | Branch rules for `main`: enable secret scanning and push protection; require `Unit tests (vitest)`, `E2E tests (playwright)`, `Smoke test against the local API`, the CodeQL check, `dependency-review`, `audit`, `gitleaks`, `Lint`, `knip`, `dup`, `slop`, `net-lines`, `Codex review`. Exact names: see the ledger, filled in by Task 41. | not verified | nothing |
| O5 | Delete branches `claude/throwaway-codex-trigger-probe` and `claude/fix-xt-token-refresh-race`, plus any listed under "branches to delete" in the ledger. | `mcp__github__list_branches` | nothing |
| O6 | After the Supabase project is deleted (on or after 2026-11-21): delete Vercel env vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. **This is the signal for Task 39.** After Task 39 merges, delete GitHub secrets `SUPABASE_*`, `BACKUP_PASSPHRASE`, `DATABASE_URL_UNPOOLED`, `BLOB_READ_WRITE_TOKEN`. | `filter_project_envs` no longer lists `VITE_SUPABASE_URL` | Task 40 |
| O7 | Optional: add `https://x-thread-draft-tool-preview.vercel.app/api/mcp` (or production) as a custom connector in Claude, approve, list drafts; again after 70 minutes. | ledger note if Shaked reports it | nothing |
| O8 | Decide Task 7.9 (#54) whenever ready (D-11). | — | Task 41 |
| O9 | Only if a merge is refused because branch rules require a review: approve or relax the rule. | the merge succeeds | the refused merge |

### 2.4 Allowed writes (everything else is forbidden)

- Git: commits and pushes to `claude/*` branches this runbook creates or already lists; `--force-with-lease` per rule 8 of the card.
- GitHub MCP: create/update PRs, comments (with footer), reply to and resolve Codex review threads,
  merge per P-MERGE, close #5 and throwaway PRs this runbook creates, create/update the ledger issue,
  `subscribe_pr_activity`, `actions_run_trigger` (`run_workflow` for `neon-preview-cleanup.yml` with
  `dry_run: true`, for `smoke-deployed.yml` and `ui-image-upload.yml` against the stable preview URL;
  `rerun_failed_jobs` once per red run).
- Neon MCP: `delete_branch` only for the 4 IDs in Task 21. Everything else is read-only (`list_branches`, `describe_project`).
- Vercel MCP: read-only (`list_deployments`, `get_deployment`, `get_deployment_events`, `filter_project_envs` without decrypt, `get_project`, `list_project_domains`) plus `web_fetch_vercel_url` on the stable preview. Never fetch production with it.
- `mcp__claude-code-remote__send_later` for wake-ups.

---

## 3. Task index

States: `todo`, `doing`, `waiting(<what>)`, `blocked(<why>)`, `parked(<owner action>)`, `done`.

| Task | What | PR | Needs | Deploys |
|---|---|---|---|---|
| 20 | Bootstrap: ledger, tools check | — | — | none |
| 21 | Housekeeping: Neon slots, #5, #35, #47 note | — | 20 | none |
| 22 | Previews only from the stable branch (`vercel.json`) | new | 21 | production on merge |
| 23 | Skip production builds for docs/CI/test-only merges | new | 22 | production on merge (last unskipped config change) |
| 24 | Neon hook: preflight, cleanup, reuse | new | 22 | skipped (CI and scripts only) |
| 25 | Login starts on the canonical origin | new | 22 | production |
| 26 | Deployed smoke signs in with OIDC (with fallback) | new | 22 | production |
| 27 | Remove the smoke fallback | new | 26 + one green production OIDC smoke | skipped |
| 28 | Task 5.1 (#57) and 5.2 (#58), then the Codex gate live check | #57, #58 | 22 | skipped |
| 29 | Task 0.3b: #56, then #34 with preview round R1 | #56, #34 | 22, 25 | production ×2, preview ×1 |
| 30 | Task 2 (#36) | #36 | 28 | skipped |
| 31 | Task 3.3, 3.4, 3.5 (#39, #40, #41) | #39–#41 | 30 | production (package.json changes) |
| 32 | Task 4 (#42) with D-8 | #42 | 31 | production |
| 33 | Task 6.0–6.3a stack (#43, #44, #45, #47) | #43–#47 | 32 | production ×3 |
| 34 | Task 7.3–7.8 stack (#48–#53) with preview round R2 | #48–#53 | 32 | production ×6, preview ×1 |
| 35 | Task 7.2: remove the bypass header | new | 26, O2 | skipped |
| 36 | Task 6.3b: draft list and login (R3) | new | 33 | preview ×1, production |
| 37 | Task 6.3c: sharing and preview (R4) | new | 36 | preview ×1, production |
| 38 | Task 3.1 (#37) then 3.2 (#38), last | #37, #38 | 34, 37 | production ×2 |
| 39 | Task 6.3d: settings (R5) | new | 34, 37 | preview ×1, production |
| 40 | Task 1.2: Supabase leftovers | new | date ≥ 2026-11-21 and O6 | production |
| 41 | Task 7.9 (#54): parked | #54 | O8 | — |
| 42 | Finish: hardening plan statuses, owner summary, runbook state DONE | new | all others done or parked | skipped |

Order note: 38 (#37, #38) runs after 39 if 39 is ready first; whichever is later rebases once. Neither may merge while the other is mid-review on the stable preview.

---

## 4. Facts and IDs (verified 2026-11-08)

- Repo `Shaked/x-thread-draft-tool`, default branch `main`, merges use merge commits.
- Vercel project `x-thread-draft-tool` (`prj_8E7qxk3jTFgBa36o2JyWL628vJd0`). Find the team with `mcp__Vercel__list_teams`.
- Domains: production `https://x-thread-draft-tool.vercel.app`; stable preview `https://x-thread-draft-tool-preview.vercel.app`, bound to git branch **`claude/lucid-sagan-bbciuo`** (the "stable branch").
- Neon project `winter-recipe-73479043`, plan `free_v3`, `owner.branches_limit = 10`. Production branch `main` = `br-spring-glade-bbc3zlza` (`default: true`, `primary: true`, `restricted_actions: delete`, but `protected: false`).
- Neon integration is Vercel-managed: one Neon branch per git branch, named `preview/<git branch>`, created when the branch's first preview deployment is created, deleted by Neon when that branch's last Vercel deployment is deleted. New deployments of the same git branch reuse its Neon branch.
- Deleting a Neon branch directly breaks the deployments that use it (database errors). Only do it for branches no longer needed.
- `scripts/migrate.mjs` ignores applied migrations it does not know, so a reused stable database works with additive migrations.
- `vercel.json` `git.deploymentEnabled` takes minimatch patterns; if any matching rule is `true`, the branch deploys.
- Workflows: `Tests` (`tests.yml`: jobs `Unit tests (vitest)`, `Smoke test against the local API`, `E2E tests (playwright)`), `smoke-deployed.yml` (job `Smoke test`), `ui-image-upload.yml` (job `Image upload (UI)`), `neon-preview-cleanup.yml`.
- `server/oidc-ci.js` trusts only `.github/workflows/ui-image-upload.yml`; audiences `x-thread-draft-tool-ci-preview` / `-production`. On production it accepts only `ref = refs/heads/main` (so `deployment_status` runs, which have no ref, are refused there today). Every route `scripts/smoke.mjs` calls is marked `ci: true`.
- Pinned actions already used in the repo: `actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4`, `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4`.
- Open PRs at writing: #5, #34–#45, #47–#54, #56–#58. Stack PRs #44–#53 all target `main`; only #54 targets #53's branch.

---

## 5. Procedures

### P-PR: open a pull request
1. `git fetch origin main && git checkout -b claude/<slug> origin/main` (or `scripts/agent-pr.sh branch claude/<slug>`).
2. Make the change. Add `docs/changelogs/<UTC YYYYMMDD-HHMMSS>-<slug>.md` (1–5 lines: what and why).
3. `npm ci` once per session if `node_modules` is missing. Commit; the pre-commit hook runs build and unit tests. Never `--no-verify`.
4. `git push -u origin claude/<slug>` (retry network failures 4× with 2/4/8/16 s backoff).
5. `mcp__github__create_pull_request` (base `main`). Body:
   ```
   Implements docs/plans/hardening-finish.md Task <NN> (hardening Task <x.y> if any).

   ## What
   ## Why
   ## Acceptance
   <each acceptance command and its real output>
   ## Deploy impact
   <none | skipped by the ignore step | production on merge | preview round>
   ```
   End with the attribution lines your session's instructions require.
6. `mcp__claude-code-remote__subscribe_pr_activity` for the PR. Then [P-CODEX](#p-codex-codex-review-loop).
7. Ledger: row → `doing`, PR number.

### P-CODEX: Codex review loop
1. After every push to a PR, post a comment whose body is `@codex review` followed by the attribution footer.
2. Wait ([P-WAIT](#p-wait-waiting-without-polling)). Codex answers with a summary comment containing
   `<!-- codex-review-state:v1 … -->` (braces HTML-escaped). It is current when its
   `code_review.commit_sha` equals the PR head and `status` is `completed`.
3. Read review threads (`mcp__github__pull_request_read` `get_review_comments`). For each unresolved
   thread by `chatgpt-codex-connector[bot]`:
   - `P0`/`P1`: fix it in this PR (smallest change that fixes it), push, go to 1. If you believe it is
     wrong, ask Opus (P-OPUS) with the finding and the code; if Opus agrees it is wrong, reply with the
     reason (plus footer) and resolve the thread.
   - `P2`/`P3`: fix only when the fix is inside this PR's files and ≤ 10 lines; otherwise leave it.
4. D-24 covers silence. After #58 is merged, the `Codex review` check run must be `success` instead
   of reading comments by hand.

### P-CI: a red check
1. Read the failing job log (`mcp__github__get_job_logs`).
2. Reproduce locally with the same command. Fix the cause in this PR only. Never skip or weaken a test.
3. Same failure twice after a fix: P-OPUS with the log excerpt and your two attempts.
4. A failure unrelated to this PR's diff (also red on `main`): `rerun_failed_jobs` once; still red → P-OPUS; if Opus says it is flaky or external, record it in the ledger and continue with other tasks; the PR waits.

### P-MERGE: merge a PR
Only when **all** of these hold (check each one, every time):
1. `MERGE_MODE: agent` in section 2.2. Otherwise record `ready to merge` in the ledger and stop here.
2. The PR is the next one in its task's order, and its stack predecessor is merged.
3. Every check run on the head SHA is `success`, or `skipped`/`neutral` by design (`get_check_runs`).
4. Codex: current summary with no unresolved `P0`/`P1` (or the `Codex review` check is `success`), or `Codex silent` recorded per D-24.
5. The task's acceptance lines are met and pasted in the PR body.
6. `mergeable_state` is `clean` (or `unstable` only because of a non-required check that P-CI recorded as external). `behind` or `dirty` → [P-UPDATE](#p-update-bring-a-pr-up-to-date) first.
7. No other runtime-affecting merge is still in [P-PROD](#p-prod-after-a-merge-to-main).

Then run the Checkpoint once more, and call `mcp__github__merge_pull_request` with `merge_method: merge`
and `expectedHeadSha` = the head SHA you checked. Then run P-PROD.

### P-UPDATE: bring a PR up to date
`git fetch origin main <branch> && git checkout <branch> && git merge --no-edit origin/main`, resolve
conflicts keeping both sides' intent, run `npm run build && npm run test:unit`, then push (no force).
Never rebase a shared stack branch. Then P-CODEX.

### P-PROD: after a merge to main
1. Find the production deployment for the merge SHA (`mcp__Vercel__list_deployments`, target production).
2. Wait until it is `READY`, `CANCELED` by the ignore step (Task 23, expected for docs/CI-only merges), or `ERROR`.
3. `READY`: the `Smoke test` run for that SHA must succeed (`mcp__github__actions_list` for `smoke-deployed.yml`, filter by `head_sha`).
4. `ERROR` or red smoke: `rerun_failed_jobs` once. Still red: open a revert PR (`git revert -m 1 <merge sha>` on branch `claude/revert-<pr>`), run P-PR on it and P-MERGE (checks green is enough, Codex optional), mark the original task `blocked(reverted: <reason>)`, P-OPUS for the diagnosis, then continue with independent tasks.

### P-PREVIEW: put a PR on the stable preview
The queue is fixed: R1 = #34, R2 = #53, R3 = Task 36's PR, R4 = Task 37's PR, R5 = Task 39's PR. Only one at a time.
1. Slot free? The stable branch's head (`git ls-remote origin refs/heads/claude/lucid-sagan-bbciuo`) is
   not the head of an open PR whose round the ledger has not marked `preview-ok`.
2. Neon preflight: `mcp__Neon__list_branches` (project `winter-recipe-73479043`). If
   `preview/claude/lucid-sagan-bbciuo` exists → reuse. Else, if fewer than `branches_limit` branches →
   OK. Else → run the cleanup workflow dry run (`actions_run_trigger` `neon-preview-cleanup.yml`,
   `dry_run: true`); if it lists candidates, wait for the daily sweep or the next PR close to delete
   them (Task 24 deletes automatically); record `waiting(neon slot)` and continue with other tasks.
3. Push: `git fetch origin <pr-branch>` then
   `git push --force-with-lease=refs/heads/claude/lucid-sagan-bbciuo:<old stable sha> origin <pr head sha>:refs/heads/claude/lucid-sagan-bbciuo`.
   If git refuses (permission or proxy), P-OPUS; if no way is found, `blocked(preview push)` for this
   round only and continue.
4. Wait for the Vercel deployment of that SHA on the stable branch to be `READY`.
5. Checks (D-18): `Smoke test` and `Image upload (UI)` runs for that SHA succeed; `web_fetch_vercel_url`
   `https://x-thread-draft-tool-preview.vercel.app/` returns 200 HTML. Plus the round's extra checks
   in its task.
6. Comment on the PR: `On the stable preview: https://x-thread-draft-tool-preview.vercel.app (commit <sha7>). Smoke: <link>. UI test: <link>.` plus footer.
7. Ledger: round `preview-ok` with links. The slot is free again.

### P-UI-REVIEW: screen review by Opus
1. On the PR branch: `npm run dev:api` in the background, then `npm run screens` (Task 6.0 harness)
   → `test-results/screens/<width>/<name>.png`. Do the same on `origin/main` for "before".
2. P-OPUS with the before/after PNG paths (390 and 1280, light and dark), the 6.3 principles from
   the hardening plan, the 6.3a files for its patterns, and the PR's label-change table. Ask for
   `APPROVE` or `CHANGES: <numbered list>`.
3. `CHANGES`: fix, push, repeat (at most 3 rounds; a 4th → record Opus's last list in the ledger and merge only if every listed item is cosmetic per Opus).
4. Paste the verdict into the PR body under "Look approval (D-17)".

### P-OPUS: consult Opus instead of asking Shaked
Use the Agent tool with `model: "opus"`, `subagent_type: "general-purpose"`, and this prompt:
```
You are the advisor for docs/plans/hardening-finish.md in the repo at <path>. Read section 1 (Rules card)
and section 2 (Decisions) first. The executor is stuck on Task <NN>, step <n>.
Question: <one sentence>
Evidence: <log excerpt, diff, finding, or measurement>
Options the executor sees: <A, B, …>
Answer with exactly: DECISION: <one option or your own>; WHY: <two sentences>; OWNER_ONLY: yes|no
(yes only if it needs a GitHub/Vercel/Neon setting, a secret, or a production data action, or breaks
a rule in section 1). Do not run commands that change anything.
```
Follow the decision. `OWNER_ONLY: yes` → add an owner action to the ledger, mark the task
`parked(<id>)`, continue with the next task. Log every consult in the ledger's Decisions log (date,
task, question, decision). Opus cannot override section 1.

### P-WAIT: waiting without polling
- PR events (checks, comments, reviews) wake you because of `subscribe_pr_activity`.
- For anything else (a Vercel deployment, a workflow run on `main`, the 30-minute Codex timer),
  call `mcp__claude-code-remote__send_later` with `delay_minutes` 10 (Codex: 30) and the message
  `Runbook checkpoint: resume Task <NN> (<what you wait for>)`, then end your turn.
- Never `sleep`-poll. Before ending a turn, the ledger must say what you wait for.

---

## 6. Tasks

### Task 20 — Bootstrap
**Done when:** the ledger issue exists and its rows match section 3.
1. `git fetch origin main claude/wizardly-brown-nuwr2f`. Read this file from `main` if it is there, otherwise from that branch.
2. Check tools: `mcp__github__get_me`, `mcp__Neon__describe_project` (`winter-recipe-73479043`), `mcp__Vercel__list_project_domains` (`x-thread-draft-tool`). A missing MCP server → record `blocked(tools: <name>)` and do what does not need it.
3. Create the ledger issue `Hardening finish: run ledger` (`mcp__github__issue_write`, method create) with:
   ```
   <!-- runbook-ledger:v1 -->
   Runbook: docs/plans/hardening-finish.md
   | Task | State | PR | Note |
   |---|---|---|---|
   | 20 | doing | - | |
   … one row per task in section 3 …
   ## Preview rounds
   R1 #34: todo · R2 #53: todo · R3: todo · R4: todo · R5: todo
   ## Decisions log
   ## Owner actions
   - [ ] O1 … (copy each row of section 2.3 as one line, with what unblocks)
   ## Branches to delete (O5)
   - claude/throwaway-codex-trigger-probe
   - claude/fix-xt-token-refresh-race
   ```
   Every later update rewrites the body (method update); keep the marker line.
4. If this runbook's own branch has no PR, open one (P-PR, title `docs: runbook to finish the hardening plan`) and merge it per P-MERGE, so this file is on `main` for every later session.

### Task 21 — Housekeeping
**Done when:** the 4 Neon branches are gone, #5 is closed, #35 and #47 have their comments.
1. `mcp__Neon__list_branches`. For each of these, confirm the **name matches the ID** and `default` is false, then `mcp__Neon__delete_branch` (Shaked approved this exact list, D-6):
   - `br-lively-hill-bb0xzptt` = `preview/claude/task-2-security-gates`
   - `br-cool-cloud-bbkcmlt6` = `preview/claude/task-7-4-token-service`
   - `br-withered-credit-bbkrxxaf` = `preview/claude/task-7-7-device-flow`
   - `br-plain-sound-bba5hw5p` = `preview/claude/task-7-9-cap-handmade-tokens`

   Any mismatch → skip that one and log it. Already gone → fine.
2. Close #5 (`update_pull_request` state closed) after a comment: "Closing: built for the Supabase Edge Function setup that the Vercel/Neon migration replaced." + footer.
3. Comment on #35: "Out of scope for docs/plans/hardening-finish.md; left open for a later decision." + footer.
4. Comment on #47: "Look approved by Shaked on the preview (2026-11-08); recorded per docs/plans/hardening-finish.md D-16." + footer.

### Task 22 — Previews only from the stable branch (D-3)
**Done when:** merged. Its no-deployment check runs in Task 23 step 5 (the branch Task 23 pushes after this merge); Task 22 is not done until that check passes. (Codex P2 on #59: avoids a done-when cycle between Tasks 22 and 23.)
**Files:** `vercel.json`, new `tests/unit/vercel-config.test.js`, `docs/agents/api.md` (one paragraph under "Databases behind previews"), changelog.
1. In `vercel.json`, add at the top level:
   ```json
   "git": {
     "deploymentEnabled": {
       "claude/**": false,
       "codex/**": false,
       "claude/lucid-sagan-bbciuo": true
     }
   }
   ```
2. Test: read `vercel.json`, assert this exact object, assert `buildCommand` and `rewrites` are unchanged from `main` (copy the values into the test).
3. Docs: "Only `main` and the stable branch `claude/lucid-sagan-bbciuo` deploy. A PR is put on the stable preview by the runbook's P-PREVIEW."
4. P-PR, P-MERGE, P-PROD.
5. Verify (run in Task 23 step 5, the branch pushed after this merge): that branch has no deployment in `mcp__Vercel__list_deployments` 10 minutes after its push. If one appears: P-OPUS.

### Task 23 — Skip production builds for docs/CI/test-only merges (D-4)
**Done when:** merged; the next docs-only merge to `main` shows a production deployment `CANCELED` by the ignore step.
**Files:** new `scripts/vercel-ignore.mjs`, new `tests/unit/vercel-ignore.test.js`, `vercel.json`, changelog.
1. `scripts/vercel-ignore.mjs`:
   ```js
   // Vercel "Ignored Build Step": exit 0 skips the build, exit 1 builds. Fails toward building.
   import { execFileSync } from 'node:child_process'
   export const SKIP = [/^docs\//, /^\.github\//, /^tests\//, /^\.claude\//, /^\.githooks\//, /\.md$/]
   export function shouldSkip(env, files) {
     if (env.VERCEL_ENV !== 'production') return false
     if (!Array.isArray(files) || files.length === 0) return false
     return files.every((f) => SKIP.some((re) => re.test(f)))
   }
   if (import.meta.url === `file://${process.argv[1]}`) {
     const prev = process.env.VERCEL_GIT_PREVIOUS_SHA
     let files = []
     try {
       if (prev) files = execFileSync('git', ['diff', '--name-only', prev, 'HEAD'], { encoding: 'utf8' }).split('\n').filter(Boolean)
     } catch { files = [] } // slop-ok: no history means build, never skip
     const skip = shouldSkip(process.env, files)
     console.log(skip ? `[ignore] skipping: only ${files.length} docs/CI/test files changed` : '[ignore] building')
     process.exit(skip ? 0 : 1)
   }
   ```
2. `vercel.json`: `"ignoreCommand": "node scripts/vercel-ignore.mjs"`.
3. Tests: preview never skips; production with only `docs/a.md` and `.github/x.yml` skips; one `src/` file builds; `scripts/migrate.mjs` builds; empty list builds.
4. P-PR, P-MERGE, P-PROD (this merge itself builds: it changes `vercel.json`).

### Task 24 — Neon hook: preflight, cleanup, reuse (D-5)
**Done when:** merged; the live dry run prints the expected lines (step 6); tests T1–T9 pass.
**Files:** `scripts/neon-preview-cleanup.mjs`, `tests/unit/neon-preview-cleanup.test.js`, new `tests/unit/neon-preview-fake-api.test.js`, `.github/workflows/neon-preview-cleanup.yml`, `docs/agents/api.md`, changelog.

1. **Protection** (`selectCandidates` and a new exported `isUndeletable(branch)`): never a candidate when any of these holds:
   - `default === true`, `primary === true`, `protected === true`;
   - `restricted_actions` contains `{ name: 'delete' }`, or the name is `main`;
   - the name doesn't start with `preview/`, or is `STABLE_PREVIEW` (`preview/claude/lucid-sagan-bbciuo`);
   - the branch has a child branch, or its git branch is the head of an open PR.

   Keep the "exactly one default branch, else abort" check.
2. **Eligibility** (deterministic, sorted by `created_at` ascending, max `MAX_DELETES` = 10 per run):
   - merged PR for that git branch, `now - merged_at ≥ graceHours`;
   - **new:** closed, unmerged PR (`closedPrs: [{head, closed_at}]`), `now - closed_at ≥ graceHours`, reason `closed PR`;
   - git branch gone and Neon branch ≥ 7 days old.

   A branch that has both an open and a closed PR stays protected.
3. **Client** (`makeNeonClient`):
   - `getProject()` → `GET /projects/{id}`; the limit is `body.project.owner.branches_limit`. If that isn't a positive integer, use env `NEON_BRANCH_LIMIT`; if that is also missing, throw `branch limit unknown; aborting`.
   - `deleteBranch(id)` refuses (throws) when the last listed branch record for `id` is undeletable.
   - HTTP 404 → return `{ alreadyDeleted: true }`.
   - HTTP 423 (operation in progress) → retry 3× after 2, 4 and 8 s.
4. **CLI** (`run`), modes as the first argument; the old `--dry-run`/`--apply` flags keep working:
   - `plan` (default): print `Neon branches: N; limit: L; candidates: C`, one `CANDIDATE`/`skip` line each, then `Dry run. Nothing deleted.`
   - `apply --confirm-count=N`: as today (manual dispatch).
   - `apply --auto [--only=preview/<branch>]`: no confirm count; deletes the candidates (only the named one with `--only`), logs `DELETED`/`already deleted`, then lists again and prints `after: N/L`.
   - `preflight --branch=<git branch>`:
     1. If `vercel.json` on the checked-out tree disables that branch (evaluate `git.deploymentEnabled` with a small matcher for `*` and `**`; any `true` match wins), print `no preview for this branch (vercel.json)` and exit 0.
     2. If `preview/<branch>` exists, print `reuse preview/<branch> (<id>)` and exit 0.
     3. If count < limit, print `ok N/L` and exit 0.
     4. Otherwise compute candidates. With `--cleanup-on-full`, delete them and list again. If still full, print to stderr exactly `limit reached: run cleanup; never remove production or a branch still in use` and exit 2.
5. **Workflow** `neon-preview-cleanup.yml`:
   - Triggers: `pull_request` (`opened, reopened, synchronize, closed`), `schedule` `17 6 * * *`, and `workflow_dispatch` (inputs as today).
   - Top-level `permissions: contents: read, pull-requests: read`; `concurrency: neon-cleanup`, no cancel.
   - One job `neon`. Checkout with `ref: ${{ github.event.repository.default_branch }}` and `persist-credentials: false`, so PR code never runs with the key.
   - Step "Collect GitHub state" as today, plus `closedPrs` (closed with `merged_at == null`: `{head, closed_at}`).
   - Step "Run": env `NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_BRANCH_LIMIT: '10'`, `HEAD_REF: ${{ github.head_ref }}`, `ACTION: ${{ github.event.action }}`, `EVENT: ${{ github.event_name }}`. The shell picks the mode:
     - `pull_request` + `closed` → `apply --auto --only="preview/$HEAD_REF" --grace-hours=0`;
     - `pull_request` other → `preflight --branch="$HEAD_REF" --cleanup-on-full`;
     - `schedule` → `apply --auto --grace-hours=24`;
     - `workflow_dispatch` → `plan`.
     - An empty `NEON_API_KEY` (fork PR) → `::notice::` and exit 0.
   - Keep the separate manual `apply` job with `environment: neon-cleanup` and confirm-count.
   - Pin actions as in section 4.
6. **Tests:**

   | # | Case | Expected |
   |---|---|---|
   | T1 | `plan` with candidates | 0 DELETE calls; prints `Dry run. Nothing deleted.` |
   | T2 | `preflight` at 10/10, no candidates | exit 2, exact message on stderr |
   | T2b | 10/10, one merged candidate, `--cleanup-on-full` | 1 DELETE, `ok 9/10` after the re-list |
   | T2c | 10/10, candidate, no flag | candidate listed, exit 2, message |
   | T3 | `preview/<branch>` exists at 10/10 | `reuse`, 0 DELETE, exit 0 |
   | T4 | `apply --auto` twice against the fake HTTP server (`node:http` on port 0 in the test, implementing `GET /projects/:id`, `GET /projects/:id/branches` with 2 pages, `DELETE /projects/:id/branches/:bid`) | second run: 0 candidates, 0 DELETE, exit 0. A 404 on DELETE logs `already deleted`, exit 0. A 423 then 200 retries |
   | T5 | today's real `main` record (`protected:false`, `primary:true`, `restricted_actions` delete) in every scenario, plus a fake `preview/main` with `primary:true` | never a candidate; `deleteBranch('br-spring-glade-bbc3zlza')` throws |
   | T6 | open-PR head, stable branch, branch with children | never candidates |
   | T7 | closed unmerged past grace; within grace | candidate `closed PR`; skip |
   | T8 | `preflight` for `claude/x` with the Task 22 `vercel.json` | `no preview for this branch` |
   | T9 | workflow text | checkout uses the default-branch ref; no `pull_request_target`; `head_ref` appears only under `env:`; every `uses:` pinned to 40 hex |

7. Local DB check (requirement: "test locally before Neon"):
   - `npm run test:api` passes (PGlite).
   - Optional, if Docker exists: `docker run --rm -d --name xt-pg -e POSTGRES_PASSWORD=x -p 5432:5432 postgres:18`. Then run `DATABASE_URL=postgres://postgres:x@localhost:5432/postgres node scripts/migrate.mjs --strict` twice; the second run prints `applied: (none)`. Then `docker rm -f xt-pg`. Paste the output.
8. P-PR, P-MERGE, P-PROD.
9. Live: `actions_run_trigger` `run_workflow` `neon-preview-cleanup.yml` on `main` with `dry_run: true`. The log must show a `Neon branches: N; limit: 10; candidates: C` line, and `skip main reason=default branch` for `main`. Paste it into the ledger.

### Task 25 — Login starts on the canonical origin (D-1)
**Done when:** merged. The live redirect check runs in Task 29 (round R1), which is what verifies it; Task 29 is not done until that check passes. (Codex P2 on #59: avoids a done-when cycle between Tasks 25 and 29.)
**Files:** `server/routes/auth.js`, `tests/api/auth.test.js`, changelog.
1. `login({ request, url })`:
   - Host = `request.headers.get('x-forwarded-host') ?? url.host`.
   - If that host differs from `new URL(appOrigin()).host`, return `redirect(`${appOrigin()}/api/auth/login`)`: no state cookie, no query passthrough.
   - Otherwise keep today's behavior.
2. Tests:
   - another host → 302 to `<PUBLIC_APP_URL>/api/auth/login` with no `set-cookie`;
   - the canonical host → GitHub redirect plus state cookie (today's test still passes);
   - an `x-forwarded-host` header that differs → redirect.

   `apiRequest` in `tests/api/helpers/db.js` uses `APP_URL`; pass `headers: { host }` or a full URL as the helper allows.
3. P-PR, P-MERGE, P-PROD.

### Task 26 — Deployed smoke signs in with OIDC (D-9)
**Done when:** merged; a production deployment's `Smoke test` run passes with the log line `auth: OIDC` (not `fallback`), recorded in the ledger.
**Files:** `server/oidc-ci.js`, `tests/api/oidc-ci.test.js`, `scripts/smoke.mjs`, `.github/workflows/smoke-deployed.yml`, `docs/agents/api.md`, changelog.
- `scripts/smoke.mjs` (Codex P1 on #59): the `me (token)` step asserts `data.auth === 'token'` (line 90). The server reports a verified CI identity as `auth: 'ci-oidc'` (`server/session.js` `via: 'ci-oidc'`, exposed by `/api/auth/me`). Accept `ci-oidc` when the run uses OIDC and `token` when it uses the fallback; any other value still fails. Add a test for both values. Codex P1 on #59 (second): `headers()` currently sends the bearer on every request, but `server/router.js` (line 85) rejects a three-part CI JWT on any route not marked `ci: true`, so `/api/health`, `/api/openapi.json` and `/api/share/:token` would return 401. Send the bearer only on requests to `ci: true` routes (a per-call flag in `call()`); public smoke requests send no `authorization` header. Add a test that the public routes get no `authorization` and the `ci: true` routes do.
1. `oidc-ci.js`:
   - Replace `CI_WORKFLOW_PATH` with `CI_WORKFLOW_PATHS = ['.github/workflows/ui-image-upload.yml', '.github/workflows/smoke-deployed.yml']`. Both `workflow_ref` and `job_workflow_ref` must equal `${REPO}/${p}@${pinned}` for the **same** `p`.
   - Production `deployment_status` (no ref) is allowed only when `claims.sha === env.VERCEL_GIT_COMMIT_SHA` and `env.VERCEL_GIT_COMMIT_REF === 'main'`. The token is then bound to the very build that runs on `main`.
   - Everything else is unchanged.
2. Tests (add): the smoke assertion for both `ci-oidc` and `token`; smoke workflow accepted on preview; another workflow file rejected; production `deployment_status` with a matching sha and ref `main` accepted; sha mismatch rejected; `VERCEL_GIT_COMMIT_REF=feature` rejected; `workflow_ref` from one file with `job_workflow_ref` from the other rejected.
3. `smoke-deployed.yml`:
   - Top-level `permissions: contents: read`; job `permissions: contents: read, id-token: write`.
   - Pin both actions.
   - Target `BASE_URL` = `deployment_status.environment_url` (the per-deployment URL, so the server's commit equals the event's) or `inputs.base_url`.
   - Audience: `x-thread-draft-tool-ci-production` when `DEPLOY_ENV == Production` or `BASE_URL` is the production domain, else `-preview`.
   - Fetch: `curl -sS -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=$AUD"`, `::add-mask::`.
   - Run `XT_TOKEN=$oidc npm run smoke` and print `auth: OIDC`.
   - **Fallback (removed in Task 27):** if `GET /api/auth/me` with the OIDC token returns 401 and the old secret for that environment is set, print `::warning::OIDC refused; using the fallback token` and `auth: fallback`, then run with the secret.
   - Remove the `XT_SMOKE_PUBLIC` preview branch (previews now get the full test). Keep the bypass header env as is (Task 35 removes it).
4. P-PR, P-MERGE, P-PROD. Then read the production `Smoke test` log for the merge SHA.
   - `auth: OIDC` → record in the ledger.
   - `auth: fallback` → read the server refusal reason (`mcp__Vercel__get_runtime_logs`, filter `[oidc-ci] refused`), then P-OPUS. A likely cause is that `VERCEL_GIT_COMMIT_SHA` is missing at runtime; if Opus confirms, the fix is reading the commit from `VERCEL_DEPLOYMENT_ID` metadata or an owner action. Mark the task `blocked` until resolved.

### Task 27 — Remove the smoke fallback
**Done when:** merged; no workflow references `XT_SMOKE_TOKEN`.
**Needs:** Task 26 done with `auth: OIDC` on production.
1. Delete the fallback block and the `XT_SMOKE_TOKEN*` env lines from `smoke-deployed.yml`. Update its header comment and `docs/agents/api.md` (smoke section, the `XT_SMOKE_PUBLIC` sentence).
2. `grep -rn "XT_SMOKE_TOKEN" .github` prints nothing.
3. P-PR, P-MERGE (P-PROD expects `CANCELED` by the ignore step). Ledger: tick "O3 ready: smoke tokens unused".

### Task 28 — Task 5 (#57, #58), then the gate live check
**Done when:** #57 and #58 are merged; a throwaway PR showed the gate fail and then pass; the throwaway is closed.
1. P-UPDATE #57 if behind; P-CODEX; P-MERGE.
2. Same for #58.
3. Live check: branch `claude/throwaway-codex-gate-check` from main. Add `server/routes/throwaway-sql.js` with an obvious SQL injection: `query(\`select * from drafts where title = '${url.searchParams.get('t')}'\`)` (not wired into the router).
   - Open the PR with the title prefix `[throwaway, do not merge]`, then post `@codex review`.
   - Expect the `Codex review` check to fail with a P0/P1. Resolve that thread (`resolve_review_thread`) and expect the check to turn green.
   - Close the PR without merging; add the branch to "Branches to delete".
   - If Codex finds nothing in 60 minutes (D-24), record `gate live check inconclusive: Codex silent` and continue.

### Task 29 — Task 0.3b: #56, then #34 (round R1)
**Done when:** both merged; R1 `preview-ok`, including the Task 25 redirect check below.
1. #56: P-UPDATE, P-CODEX, P-MERGE, P-PROD.
2. #34: P-UPDATE (brings in #56 and Task 25), P-CODEX, then P-PREVIEW R1.
   - Extra check: `web_fetch_vercel_url` of the stable deployment's own per-deployment URL `/api/auth/login` must return a 302 whose `Location` starts with `https://x-thread-draft-tool-preview.vercel.app/api/auth/login` (Task 25 live check).
   - `npm audit --audit-level=moderate` output goes in the PR body.
3. P-MERGE, P-PROD.

### Task 30 — Task 2 (#36)
**Done when:** merged; CodeQL, `dependency-review`, `audit`, `gitleaks` green on `main`.
P-UPDATE, P-CODEX, P-MERGE, P-PROD (skipped build expected). Add the exact check names to the ledger for O4.

### Task 31 — Task 3.3, 3.4, 3.5 (#39, #40, #41), in that order
**Done when:** all three merged; `npm run dup`, `node scripts/slop-scan.mjs`, net-lines green on `main`.
For each PR: P-UPDATE, then run its check locally on the updated branch.
- Any new finding from code that came from main: fix it in this PR only if it's ≤ 10 lines. Otherwise raise the jscpd threshold to the newly measured value rounded up (3.3 allows that), or for slop-scan fix the line, or P-OPUS.
- Then P-CODEX, P-MERGE, P-PROD. Record check names for O4.

### Task 32 — Task 4 (#42) with D-8
**Done when:** merged; the CI log shows every file ≤ its limit and total ≤ 30 s.
1. P-UPDATE. Read the latest CI `Unit tests (vitest)` log for the 5 slowest lines.
2. If `tests/api/migrate.test.js` is > 3000 ms: in `scripts/test-budget.mjs` add
   `const FILE_LIMIT_MS = { 'tests/api/migrate.test.js': 5000 } // boots a fresh PGlite to test migrations; hardening Task 4 stop-if, decided 2026-11-08`
   and use it in the per-file check. Add a test case for the override.
3. Re-run CI twice more (`rerun_workflow_run`). All three runs must pass. Paste the slowest-5 lines.
4. P-CODEX, P-MERGE, P-PROD.

### Task 33 — Task 6.0 to 6.3a (#43, #44, #45, #47)
**Done when:** all four merged.
In order. For each: P-UPDATE (after the previous one merges), P-CODEX, P-MERGE, P-PROD.
- #45 acceptance (light by default; Dark survives a reload) is covered by `tests/unit/theme.test.js` plus the 6.0 screenshots in its PR; add them to its PR body if missing (run the harness).
- #47: D-16.

### Task 34 — Task 7.3 to 7.8 (#48 → #53), round R2
**Done when:** all six merged; R2 `preview-ok`; #54 still open (parked).
1. P-UPDATE #53 only (it contains #48–#52). P-CODEX on #53. P-PREVIEW R2 with #53's head. Extra checks with `web_fetch_vercel_url` on the stable preview:
   - `/.well-known/oauth-authorization-server`: 200 JSON, `issuer` = `https://x-thread-draft-tool-preview.vercel.app`, `code_challenge_methods_supported` contains `S256`.
   - `/.well-known/oauth-protected-resource/api/mcp`: 200 JSON, `resource` = `https://x-thread-draft-tool-preview.vercel.app/api/mcp`.
   - `/settings/tokens`: 200 HTML.

   If `issuer` is a different host, `PUBLIC_APP_URL` for Preview is not the stable host: P-OPUS (likely owner action).
2. Then merge bottom-up: #48, #49, #50, #51, #52, #53. For each: P-UPDATE if `behind`/`dirty`, P-CODEX if you pushed, P-MERGE, P-PROD.
   - #48 adds a migration to production: P-PROD must also show `[migrate] applied: 003_oauth.sql` in the production build log (`get_deployment_events`).
3. #51 legacy versions: confirm `SUPPORTED_VERSIONS` includes `2025-06-18` and the latest spec version (already true on the branch).
4. Ledger: O7 becomes available.

### Task 35 — Task 7.2: remove the bypass header
**Done when:** merged; preview smoke passes without the secret.
**Needs:** O2 verified (`get_project`: no `ssoProtection`). Until then `parked(O2)`.
1. Remove `VERCEL_AUTOMATION_BYPASS_SECRET` from `scripts/smoke.mjs`, `smoke-deployed.yml`, `ui-image-upload.yml` (if present), `docs/agents/api.md`.
2. P-PR, P-MERGE. Ledger: "O3 ready: bypass secret unused".

### Task 36 — Task 6.3b: draft list and login (R3)
**Done when:** merged; R3 `preview-ok`; P-UI-REVIEW `APPROVE`.
Build per hardening 6.3 (`DraftList`, `LoginPage`), reusing 6.3a's classes and patterns. The PR body has the label-change table and screenshots. P-PR, P-CODEX, P-UI-REVIEW, P-PREVIEW R3, P-MERGE, P-PROD.

### Task 37 — Task 6.3c: sharing and preview (R4)
Same as Task 36 for `ShareButton`, `ExportOptions`, `XThreadLinkButton`, `AgentLinkButton`, `XThreadPreviewPage`, `ThreadPreview`. Round R4.

### Task 38 — Task 3.1 (#37), then 3.2 (#38), last
**Done when:** both merged; `npm run lint` and `npx knip` exit 0 on `main`.
1. #37: P-UPDATE. Run `npm run lint`; fix new errors in code from the merged stacks by fixing the code, never with `eslint-disable` (if one is unavoidable, put a reason on the same line and list it in the PR body). P-CODEX, P-MERGE, P-PROD.
2. #38: P-UPDATE. Run `npx knip`. Delete newly unused code only when it is truly unused (grep for dynamic use); a confirmed false positive goes in `ignore` with a comment. P-CODEX, P-MERGE, P-PROD.

### Task 39 — Task 6.3d: settings (R5)
**Needs:** Task 34 (Connected apps from 7.8) and Task 37. Same as Task 36 for `TokensPage`, including "Connected apps" and moving the deployment banner to an "About" line. Round R5.

### Task 40 — Task 1.2: Supabase leftovers
**Needs:** today ≥ 2026-11-21 **and** O6 verified (`filter_project_envs` lists no `VITE_SUPABASE_URL`). Until then `parked(O6)`; check again at every session start.
Do hardening Task 1.2 exactly. P-PR, P-MERGE, P-PROD. Ledger: "O6 second half ready".

### Task 41 — Task 7.9 (#54): parked
`parked(O8)`. Do nothing until the ledger records Shaked's decision. If the decision is "go":
- confirm Task 26 shows `auth: OIDC` on production;
- P-UPDATE (#54's base becomes `main` after #53 merges; change the base with `update_pull_request` if needed);
- P-CODEX, P-MERGE, P-PROD;
- the 7.9 acceptance (`GET /api/tokens` on production after deploy) needs a signed-in human: add it to the ledger as owner action O10 instead of reading production data.

### Task 42 — Finish
**Done when:** every task is `done` or `parked`; this PR is merged; the ledger is closed or left open only for parked items.
1. One docs PR:
   - In `post-migration-hardening.md`, set each task's Status line to `Done (PR #NN)` or `Parked: <reason>`.
   - Add a line under its title: "Finished via docs/plans/hardening-finish.md."
   - In this file set `Runbook state: DONE` (the hook goes quiet).
   - Update `docs/plans/current.md` if it lists this work.
2. Rewrite the ledger body with a final summary: merged PRs, parked tasks, the open owner actions (O-list with what each unblocks), and the exact required-check names for O4.
3. If nothing is parked, close the ledger issue (`state_reason: completed`); otherwise leave it open.

---

## 7. Acceptance for the whole runbook
- Every hardening task is merged or in `parked(Ox)` with its owner action listed.
- `main` is green: `Tests`, CodeQL, security jobs, net-lines, Codex gate.
- Neon: at most `main` plus the stable branch plus branches of open PRs that still deploy; the daily sweep has run without error at least once.
- No workflow on `main` references `XT_SMOKE_TOKEN*`; production smoke runs with `auth: OIDC`.
- Preview deployments created by this runbook: 5 (R1–R5), all on `preview/claude/lucid-sagan-bbciuo`.
