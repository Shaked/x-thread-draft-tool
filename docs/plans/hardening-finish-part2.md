# Hardening finish, part 2: remaining work, bug fixes and tracker

Written 2026-11-09 22:00 UTC. For an executor that follows instructions literally.
This file continues [hardening-finish.md](./hardening-finish.md) ("the runbook"). It does not replace it.

**How to use this file**

1. Read the runbook's section 0 (Checkpoint), section 1 (Rules card), section 2.4 (Allowed writes) and section 5 (Procedures: P-PR, P-CODEX, P-CI, P-MERGE, P-UPDATE, P-PROD, P-PREVIEW, P-UI-REVIEW, P-OPUS, P-WAIT).
2. Read this file's section 1 (state), section 2 (extra rules) and section 3 (tracker).
3. Do the steps in section 4 in order, one step at a time. After each step, update the ledger (issue #60) and run the Checkpoint.
4. Where this file and the runbook differ, this file wins. The differences are listed in section 2 (rule E0).
5. Never ask Shaked a question. Questions go to Opus (P-OPUS). If Opus says owner-only, park the task and go on.

---

## 1. State (verified 2026-11-09 22:00 UTC)

`main` is at `0efe2ae` (merge of #49). Production is READY on it and its smoke test passed.

**Merged:** Tasks 20 to 31 and 33, and from Task 34 the pull requests #48 and #49.
The light theme (#45), the screenshot harness (#43) and the editor redesign (#47) are merged and live.

**Open pull requests**

| PR | Task | Branch | Head | Base | State |
|---|---|---|---|---|---|
| #50 | 34 (7.5) | `claude/task-7-5-authorization-server` | `9e1b2527f7753b86a4007cbd1dcfd804fbb528ef` | `main` at `0efe2ae` | Up to date. All checks green except `Codex review`. Codex reviewed this head twice and found nothing. The check fails only because old review threads are not resolved (step S1). |
| #51 | 34 (7.6) | `claude/task-7-6-mcp-endpoint` | `aafe196` | old `main` | Needs P-UPDATE after #50 merges. |
| #52 | 34 (7.7) | `claude/task-7-7-device-flow` | `3601d94` | old `main` | Needs P-UPDATE after #51 merges. |
| #53 | 34 (7.8) | `claude/task-7-8-connected-apps` | `18e4fcf` | old `main` | Top of the stack. Preview round R2. |
| #54 | 41 (7.9) | `claude/task-7-9-cap-handmade-tokens` | `749e30a` | `claude/task-7-8-connected-apps` | Parked (O8). Do not merge. |
| #37 | 38 (3.1) | `claude/task-3-1-eslint` | `a875da8` | old `main` | Waits for Task 37. |
| #38 | 38 (3.2) | `claude/task-3-2-knip` | `bcb78d1` | old `main` | Waits for #37. |
| #42 | 32 (4) | `claude/task-4-test-budget` | `a6e83bc` | old `main` | Skipped by Shaked ("Skip 42"). Do not touch. See bug B5. |
| #35 | none | `claude/vigilant-curie-vwlzcp` | `ab15b24` | old `main` | Out of scope (D-13). Do not touch. |

Heads change. Always read the real head with `mcp__github__pull_request_read` (`get`) before you use one.

**Preview rounds:** R1 done. R2 (#53), R3 (Task 36), R4 (Task 37), R5 (Task 39) remain.

---

## 2. Extra rules (they fix mistakes made in part 1)

- **E0. Differences from the runbook.**
  - Task 34 order: merge #50 first, then run R2 on #53. Reason: #50 is finished and reviewed, and #53 needs #50's fixes before its preview means anything.
  - Task 32 (#42) is skipped by Shaked's order. Its row is `skipped(owner)`. Task 33 and later do not wait for it.
  - Task 42 has two extra parts (step S13).
- **E1. Where Codex answers.** Codex posts a clean result as an ordinary PR comment, not as a review. To know what Codex said, always read all three:
  1. `pull_request_read` `get_comments`: find the newest comment by `chatgpt-codex-connector[bot]`. It is current when its `commit_sha` (inside `<!-- codex-review-state:v1 ... -->`, or in the visible text) equals the PR head.
  2. `pull_request_read` `get_review_comments`: the review threads and whether each is resolved.
  3. `pull_request_read` `get_check_runs`: the `Codex review` check.

  Never decide "Codex silent" from `get_reviews`. Record `Codex silent` only when `get_comments` shows no Codex comment for the head 60 minutes after the first `@codex review` (rule D-24: ask once more at 30 minutes).
- **E2. Why the `Codex review` check fails.** It counts every unresolved Codex thread, even an outdated one. `P0`/`P1` threads block. `P2`/`P3` threads do not. So after you fix a finding and Codex has reviewed the new head:
  1. Reply on the thread: `Fixed in <sha7>: <one line>` plus the footer.
  2. Resolve it with `mcp__github__resolve_review_thread`.
  3. Read `get_check_runs` again. If `Codex review` is not `success` after 3 minutes, or shows `cancelled`, find the newest `Codex gate` run for the PR (`mcp__github__actions_list`) and call `mcp__github__actions_run_trigger` with `method: rerun_workflow_run` and that `run_id` (a number). Do this once per head.

  Resolve a thread only when its fix is in the code, or Opus agreed the finding is wrong. A `P2`/`P3` you did not fix stays unresolved, and you write it under "Known gaps" in the PR body and in the ledger's follow-up list.
- **E3. Time.** Run `date -u` when you need the time. Never guess it.
- **E4. Waiting.** After `@codex review` or a push, end the turn. PR events wake you. For anything that sends no PR event, call `send_later` once (10 minutes; Codex 30) and end the turn. Never check the same thing twice in one turn. Never `sleep`.
- **E5. If a stop hook says the work is not finished.** Do not repeat checks and do not invent work. Write a short true status ("waiting for X on PR #N; the next step is S<n>") and end the turn. Do not edit hook or permission settings. See bug B7.
- **E6. Ledger.** The table in the body of issue #60 is the tracker. After every step, rewrite the body with `mcp__github__issue_write` (keep the first line `<!-- runbook-ledger:v1 -->`). Add a comment only for a decision or a problem. If an earlier comment was wrong, add a new comment that says so.
- **E7. Commits and PR text.** No model names anywhere. End a commit message with the `Claude-Session:` line your session gives you and nothing else about the tool. End every GitHub comment with:
  ```

  ---
  _Generated by [Claude Code](https://claude.ai/code)_
  ```
- **E8. API tests.** A new file under `tests/api/` starts with `// @vitest-environment node` and sets `process.env.SESSION_SECRET` in `beforeAll` if it signs tokens.
- **E9. Conflicts in the 7.x stack.** During P-UPDATE, find the PR's own files with
  `git diff --name-only origin/<branch below it>...origin/<this branch>` (for #51 the branch below is `claude/task-7-5-authorization-server`, and so on up).
  A conflicted file that is **not** in that list: take main's side with `git checkout --theirs <file> && git add <file>`.
  A conflicted file that **is** in the list: keep both sides' intent by hand. If the build or tests fail twice after your resolution, P-OPUS.
- **E10. Tool notes.** `get_job_logs` needs a job id, not a check-run id. `update_pull_request_branch` fails on conflicts; then do P-UPDATE locally. After a session restart the MCP tools can be missing for a minute; load them with ToolSearch and try once more.
- **E11. Explain blockers plainly.** When a task is parked, the ledger line says what Shaked has to do, where to click, and what it unblocks.

---

## 3. Tracker

The live copy is the body of issue #60. This is the starting state.

| Step | Task | What | PR | State | Next action | Done when |
|---|---|---|---|---|---|---|
| S0 | none | This plan on `main` | new | todo | Open a docs PR for this file | merged |
| S1 | 34 | Unblock and merge 7.5 | #50 | doing | Reply to and resolve 4 fixed threads | merged, production READY, smoke green |
| S2 | 34 | Update #53, Codex, preview R2 | #53 | todo | P-UPDATE after S1 | R2 `preview-ok` |
| S3 | 34 | Merge 7.6 | #51 | todo | P-UPDATE after S2 | merged, production READY, smoke green |
| S4 | 34 | Merge 7.7 | #52 | todo | P-UPDATE after S3 | merged, production READY, smoke green |
| S5 | 34 | Merge 7.8 | #53 | todo | P-UPDATE after S4 | merged, production READY, smoke green |
| S6 | none | Fix: gate masking gap (B3) | new | todo | After S1 | merged |
| S7 | none | Fix: refresh race (B4) | new | todo | After S4 | merged, or parked by Opus |
| S8 | none | Fix: long return path (B2) | new | todo | After S5 | merged, or parked by Opus |
| S9 | 36 | 6.3b draft list and login, R3 | new | todo | After S5 | merged, R3 `preview-ok`, look `APPROVE` |
| S10 | 37 | 6.3c sharing and preview, R4 | new | todo | After S9 | merged, R4 `preview-ok`, look `APPROVE` |
| S11 | 39 | 6.3d settings, R5 | new | todo | After S5 and S10 | merged, R5 `preview-ok`, look `APPROVE` |
| S12 | 38 | ESLint, then knip | #37, #38 | todo | After S11 | both merged; `npm run lint` and `npx knip` exit 0 on `main` |
| S13 | 42 | Finish docs PR, final ledger | new | todo | After all above | merged; ledger final |
| P1 | 32 | Test budget | #42 | skipped(owner) | none | Shaked says go (B5) |
| P2 | 35 | Remove the bypass header | new | parked(O2) | Check O2 at each session start | O2 verified, then merged |
| P3 | 40 | Supabase leftovers | new | parked(O6) | Check date and O6 at each session start | date ≥ 2026-11-21 and O6 verified, then merged |
| P4 | 41 | Cap hand-made tokens | #54 | parked(O8) | none | Shaked decides in the ledger |

---

## 4. Steps

Each step: do it, update the ledger row, run the Checkpoint, go to the next step.
If a step waits on something, take the next step whose "after" condition is met. If none is, P-WAIT.

### S0. Put this plan on `main`
1. This file is on branch `claude/relaxed-allen-b47d1n`. Open a PR from it to `main` (P-PR from step 5; the changelog file is already there).
2. P-CODEX, P-MERGE. The production build is skipped for docs-only merges (expected: `CANCELED` by the ignore step).
3. Do not wait for S0. Start S1 at once.

### S1. Unblock and merge #50
1. Read `get_review_comments` on #50. Check that the head is still `9e1b2527f7753b86a4007cbd1dcfd804fbb528ef`. If it is not, stop and treat #50 as a normal P-CODEX loop.
2. For each thread below: reply to its first comment (`add_reply_to_pull_request_comment`) with the text given plus the footer, then resolve it (`resolve_review_thread`).

   | Thread | Severity | Reply text |
   |---|---|---|
   | `PRRT_kwDOQ7YGcM608jqd` | P1 | `Fixed in this PR: reactivating a grant deletes its old tokens and codes inside one locked transaction.` |
   | `PRRT_kwDOQ7YGcM608jqg` | P2 | `Fixed in this PR: spending the code and issuing the tokens happen in one transaction.` |
   | `PRRT_kwDOQ7YGcM61J6ka` | P2 | `Fixed in 06bd0c4: the consent token limit is 16384 characters, with a test.` |
   | `PRRT_kwDOQ7YGcM61KDcm` | P2 | `Fixed in 9e1b252: a session cookie that carries an audience is refused, with a test.` |

   Before you resolve the first two, open the file each thread points to and confirm the fix is in the code on the head. If one is not, do not resolve it: fix it (P-CODEX) or P-OPUS.
3. Leave `PRRT_kwDOQ7YGcM61KDco` (P2, long return path) unresolved. It is a known gap in the PR body and is step S8.
4. Follow E2 step 3 until `Codex review` is `success`.
5. P-MERGE with `expectedHeadSha` = the head from step 1. Then P-PROD.
6. Ledger: #50 merged with its merge SHA and smoke run number. Add a comment: "Comments 6733988858 and 6737322593 were wrong. Codex had answered in PR comments; #49 and #50 were never blocked by Codex silence."

### S2. #53: update, Codex, preview round R2
1. P-UPDATE on `claude/task-7-8-connected-apps` (rule E9; the branch below it is `claude/task-7-7-device-flow`).
   `tests/unit/vercel-config.test.js` and `server/routes/auth.js` conflict the same way they did on #50: take main's side.
2. `npm run build && npm run test:unit` must pass. Push. P-CODEX (rules E1, E2).
3. P-PREVIEW round R2 with #53's head.
4. Extra checks with `mcp__Vercel__web_fetch_vercel_url` on `https://x-thread-draft-tool-preview.vercel.app`:
   - `/.well-known/oauth-authorization-server`: 200, JSON, `issuer` is `https://x-thread-draft-tool-preview.vercel.app`, `code_challenge_methods_supported` contains `S256`.
   - `/.well-known/oauth-protected-resource/api/mcp`: 200, JSON, `resource` is `https://x-thread-draft-tool-preview.vercel.app/api/mcp`.
   - `/settings/tokens`: 200, HTML.

   If `issuer` shows another host: P-OPUS (probably an owner action about `PUBLIC_APP_URL` for Preview). Then continue with S3; do not wait.
5. Post the P-PREVIEW comment on #53. Ledger: R2 `preview-ok` with links. Do not merge #53 yet.

### S3. Merge #51
1. P-UPDATE on `claude/task-7-6-mcp-endpoint` (E9; branch below: `claude/task-7-5-authorization-server`). Push. P-CODEX.
2. Confirm `SUPPORTED_VERSIONS` (search `server/` for it) contains `2025-06-18` and the newest version. Write the line you found in the PR body under "Acceptance".
3. P-MERGE, P-PROD.
4. Ledger: O7 is now available (optional for Shaked). The PR's "Needs Shaked" item (keep the old MCP versions or not) goes to the ledger as a note: "kept; remove later if wanted". It blocks nothing.

### S4. Merge #52
1. P-UPDATE on `claude/task-7-7-device-flow` (E9; branch below: `claude/task-7-6-mcp-endpoint`). Push. P-CODEX.
2. P-MERGE, P-PROD. The refresh-race gap in its body is step S7; it does not block the merge.

### S5. Merge #53
1. P-UPDATE again (it is behind after S3 and S4). Push. P-CODEX.
2. P-MERGE, P-PROD.
3. #54's base branch is now merged. Call `update_pull_request` on #54 with `base: main`. Do nothing else to #54.
4. Ledger: Task 34 `done`.

### S6. Fix the gate's masking gap (bug B3)
1. Read `scripts/codex-gate.mjs` and its tests. Ask Opus (P-OPUS): "Outdated unresolved Codex P2 threads hide the summary-flag fallback. What is the smallest correct change?" Give it the file.
2. Make that change with a unit test that fails before and passes after. Do not weaken the gate: a `P0`/`P1` thread must still block.
3. P-PR (branch `claude/codex-gate-masking-gap`), P-CODEX, P-MERGE. Production is skipped (CI and scripts only).
4. If Opus says "leave it": write its reason in the ledger, mark S6 `done (no change)`.

### S7. Fix the refresh race (bug B4)
1. Read the refresh path in `server/oauth/tokens.js` and `scripts/agent-credentials.mjs`. P-OPUS with the code: "Two refreshes at the same time revoke the whole grant. Choose: (A) a file lock in `agent-credentials.mjs` so one process refreshes at a time; (B) a short server grace window for the previous refresh token; (C) leave it." Opus's usual safe answer is A, because it does not loosen the server's reuse detection.
2. Do what Opus decides, with a test. P-PR (`claude/refresh-race-guard`), P-CODEX, P-MERGE, P-PROD.
3. Branch `claude/fix-xt-token-refresh-race` already exists and is listed for deletion in O5. Do not use it.

### S8. Fix the long return path (bug B2)
1. P-OPUS with `server/routes/auth.js` (`safeReturnTo`, `login`) and thread `PRRT_kwDOQ7YGcM61KDco`: "A signed-out user whose authorize request is longer than 2,000 characters loses it across GitHub sign-in. Choose: (A) keep the pending authorize request in a signed, short-lived cookie and put only a marker in the return path; (B) leave it as a documented limit." 
2. A: implement with tests (`// @vitest-environment node`), P-PR (`claude/oauth-long-return-path`), P-CODEX, P-MERGE, P-PROD. B: write the limit in `docs/agents/api.md` in a docs PR and mark S8 `done (documented)`.

### S9. Task 36: draft list and login (R3)
1. Read `post-migration-hardening.md` Task 6.3 (principles and order) and the merged 6.3a code (`DraftEditor`, `PostBox`, the CSS classes it added). Reuse those classes. Do not invent new patterns.
2. Branch `claude/task-6-3b-draft-list-login` from the latest `main`. Change `DraftList` and `LoginPage` only (plus their tests and CSS).
3. The PR body has: a before/after table of every visible label that changed, and screenshots from `npm run screens` (390 and 1280, light and dark).
4. P-PR, P-CODEX, P-UI-REVIEW, P-PREVIEW R3, P-MERGE, P-PROD.
5. If the `net-lines` check fails: read its log, remove dead CSS or markup you replaced. Never raise its limit. Still failing: P-OPUS.

### S10. Task 37: sharing and preview (R4)
Same as S9 on branch `claude/task-6-3c-sharing-preview` for `ShareButton`, `ExportOptions`, `XThreadLinkButton`, `AgentLinkButton`, `XThreadPreviewPage`.
`src/components/ThreadPreview.jsx` is not imported anywhere on `main` (checked 2026-11-09). Check again with `git grep -n "ThreadPreview'" -- src`. If it is still unused, do not restyle it: say so in the PR body, and #38 deletes it in S12.

### S11. Task 39: settings (R5)
Needs S5 and S10. Same as S9 on branch `claude/task-6-3d-settings` for `TokensPage`: "Connected apps" goes below the page heading; the deployment banner (`.deployment-meta`) leaves the top of every page and becomes one small "About" line at the bottom of the settings page. Round R5.

### S12. Task 38: #37, then #38
These branches are old and the UI changed under them. Expect conflicts.
1. #37: P-UPDATE. If more than 5 files conflict, or build or tests fail twice: P-OPUS with the option "redo on a fresh branch `claude/task-3-1-eslint-v2` from `main`: copy `eslint.config.js` and the `package.json` changes, run `npm run lint`, fix the code; then comment on #37 that the new PR replaces it". Do not close #37 yourself (not in the allowed writes); list it in the ledger under "PRs for Shaked to close".
2. `npm run lint` must exit 0. Fix code; do not add `eslint-disable` (if one cannot be avoided: reason on the same line, listed in the PR body). P-CODEX, P-MERGE, P-PROD.
3. #38: same, with `npx knip` exit 0. Delete code only when `git grep` shows no use, including dynamic use. A confirmed false positive goes in `knip.json` `ignore` with a comment. P-CODEX, P-MERGE, P-PROD.
4. Paste the exact names of the new checks (`get_check_runs` on the merged heads) into the ledger for O4.

### S13. Task 42: finish
Do the runbook's Task 42, plus:
1. In the docs PR also set, in this file, the first line under the title to `State: DONE`.
2. The final ledger body lists: every merged PR with its task; skipped #42 (B5); parked tasks with the plain-language owner action; follow-ups not done; "PRs for Shaked to close"; the exact check names for O4.
3. Check the runbook's section 7 (acceptance) line by line and paste the evidence into the ledger. A line that cannot be met because of a parked or skipped task: say which.

### Parked items: check at every session start
- **P2 (Task 35):** `mcp__Vercel__get_project`. If `ssoProtection` is null, O2 is done: do the runbook's Task 35.
- **P3 (Task 40):** `date -u` ≥ 2026-11-21 **and** `filter_project_envs` no longer lists `VITE_SUPABASE_URL`: do the runbook's Task 40.
- **P4 (Task 41):** only when a ledger comment by Shaked says go.
- **P1 (#42):** only when Shaked says go.

---

## 5. Bugs and how each is handled

| ID | Bug | Handled by |
|---|---|---|
| B1 | #50's `Codex review` check is red although Codex found nothing on the head: four fixed threads were never resolved. | S1, rule E2 |
| B2 | A signed-out user loses an authorize request longer than 2,000 characters across GitHub sign-in (`server/routes/auth.js`, Codex P2). | S8 |
| B3 | Codex gate: outdated unresolved P2 threads hide the summary-flag fallback (`scripts/codex-gate.mjs`). | S6 |
| B4 | Two refreshes at the same time revoke the whole grant (#52 known gap). | S7 |
| B5 | #42 (test budget) was skipped: its bare `CodeQL` check failed and nobody found out why. Not merged, so the test time budget is not enforced. | Skipped by Shaked. Stays `skipped(owner)`. When Shaked says go: P-UPDATE, read the failing check's log (P-CI), then the runbook's Task 32. |
| B6 | Sign-in on the preview shows "Invalid OAuth state". The preview has no GitHub OAuth App of its own. | Owner action O1. No executor work. No automated check needs a human sign-in. |
| B7 | A stop hook in the session repeats an old message (it says #43 and #45 are open; they are merged) and blocks the end of a turn. It is not in this repository. | Rule E5. Owner note in section 6. |
| B8 | The ledger body was stale and two comments said "Codex silent" wrongly. | Body rewritten on 2026-11-09; correction comment in S1 step 6; rule E6. |
| B9 | The executor read only `get_reviews` and missed Codex's answers. | Rule E1 |
| B10 | The executor guessed the time and polled in a loop. | Rules E3, E4 |
| B11 | No CORS headers on the token and metadata endpoints, so a browser-only MCP client fails (#50 deviation). | Not in the plan. Ledger follow-up; do nothing unless Shaked asks. |
| B12 | The client-metadata fetch can be fooled by DNS rebinding, like `server/remote-image.js` (#50 known gap). | Ledger follow-up; do nothing unless Shaked asks. |

---

## 6. What Shaked has to do (plain language; nothing here stops the steps above unless it says so)

| ID | What to do | Where | What it unblocks |
|---|---|---|---|
| O1 | Create a second GitHub OAuth App for the preview site (callback `https://x-thread-draft-tool-preview.vercel.app/api/auth/callback`, Device Flow on). In Vercel, keep the current `GITHUB_CLIENT_ID`/`SECRET` for Production only and add the new pair for Preview only. | GitHub → Settings → Developer settings → OAuth Apps; Vercel → Project → Settings → Environment Variables | Signing in on the preview by hand (fixes "Invalid OAuth state"). |
| O2 | Turn off "Vercel Authentication". | Vercel → Project → Settings → Deployment Protection | Task 35 |
| O3 | Delete the Actions secrets `XT_SMOKE_TOKEN` and `XT_SMOKE_TOKEN_PRODUCTION` and revoke those two tokens on `/settings/tokens`. After Task 35 also delete `VERCEL_AUTOMATION_BYPASS_SECRET`. | GitHub → Repo → Settings → Secrets and variables → Actions | Cleanup only |
| O4 | Require the checks on `main` (names are in the ledger; the last ones arrive after S12). | GitHub → Repo → Settings → Rules | Makes the gates binding |
| O5 | Delete branches `claude/throwaway-codex-gate-check`, `claude/throwaway-codex-trigger-probe`, `claude/fix-xt-token-refresh-race`, and close the PRs listed under "PRs for Shaked to close". | GitHub → Branches / Pull requests | Cleanup only |
| O6 | On or after 2026-11-21, after deleting the Supabase project: delete `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. | Vercel → Project → Settings → Environment Variables | Task 40 |
| O7 | Optional: add `/api/mcp` as a connector in Claude and try it. | Claude → Settings → Connectors | Nothing |
| O8 | Decide whether hand-made tokens expire after 7 days (#54). Write "go" or "no" as a comment on issue #60. | Issue #60 | Task 41 |
| O9 | Only if GitHub refuses a merge because a review is required: approve, or relax the rule. | GitHub | That merge |
| O11 | Decide whether #42 (test time budget) should be picked up again. Write it on issue #60. | Issue #60 | Task 32 |
| O12 | The session's stop hook is out of date. Remove it or change its text in the session or account settings. It is not in the repository. | Claude Code settings (hooks) | Sessions end their turns normally |

---

## 7. Finished when

- Steps S0 to S13 are `done` (S6 to S8 may be `done (no change)` or `done (documented)` with Opus's reason in the ledger).
- P1 to P4 are done or still parked with their owner action in the ledger.
- The runbook's section 7 holds, with exceptions named.
- `main` is green and production is READY with a passing smoke test on the last runtime merge.
