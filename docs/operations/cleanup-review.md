# Daily cleanup review: rules for the agent

Epic #255. Shaked decided the goal on 2026-11-19. This file decides what the agent may delete, so every rule here is strict on purpose.

## How a run starts

- The workflow `.github/workflows/cleanup-review-daily.yml` (task C1, #256) runs every day at **04:17 UTC**.
- It does nothing when no commit since the last run changed anything outside `docs/changelogs/`. That check costs no tokens.
- When something changed, it opens **one** issue `Cleanup review <date>` with the labels `task` and `cleanup`. The issue body is `.github/cleanup-review-issue.md` plus the commit list and the changed files. The dispatcher then starts an agent session for it.
- It opens no new issue while an earlier `cleanup` issue is still open.
- Telegram: labelling a PR `cleanup-pr` sends one message. That is task C3 (#258). Until C3 is merged, nothing is sent.

## Goal

Remove what is useless, so the repository is easier to read and cheaper to run:

1. Tests that repeat another test, or check the same behaviour twice.
2. Brittle tests: snapshot tests or tests of internal details that fail on every harmless change and check nothing a user sees.
3. Dead or unused code.
4. Docs that are wrong, duplicated, or unlinked. A doc is unlinked when no other file links to it and no index lists it. Unlinked is a signal to check, never a reason to delete on its own: see the never-touch list.
5. Slop: filler in comments and docs, such as comments that only repeat the code, empty phrases, and boilerplate.

The agent only proposes changes. Shaked merges them.

## Never touch

- **Security tests**: auth, admin, OAuth, CSP, share links, deletion. A test is a security test if its file name or test title contains auth, token, session, cookie, admin, suspend, oauth, csp, share, delete or revoke, or if it checks a 401, 403 or 404 response. Do not remove these.
- **Smoke checks**: `scripts/smoke.mjs` and the smoke tests run after a deploy.
- **Regression tests**: any test that pins a bug that was fixed. Keep it even when it looks like a duplicate.
- **The gates**: the net-lines check (`scripts/net-lines.mjs`), the duplicate check (`npm run dup`), the time budget (`npm run test:budget`), and the slop scan (`npm run slop`). Do not weaken a limit to make a PR pass.
- **Decisions**: anything an issue records as decided. Search the issues before you remove a feature's tests or docs.
- **History**: `docs/changelogs/` (these are the record of what changed).
- **Owner and agent docs**: everything under `docs/operations/`, `docs/agents/`, `docs/plans/`, `public/`, `AGENTS.md`, `CLAUDE.md`, `.claude/` and `.githooks/`. Being unlinked is not a reason to remove these.
- **Everything under `.github/` and `scripts/`**: only filler in comments may change.
- **Migrations, secrets and environment handling.**

When unsure, do not remove. Write the item in the PR body (or the issue comment) as "not removed: reason".

## Evidence before any removal

Every removal needs written evidence in the PR body.

- **Duplicate test**: name the test that still covers the same behaviour (file and test title). Quote the assertion lines of the removed test and of the test that stays. Every removed assertion must appear, with the same input and the same expected value, in the test that stays. Show it passes after the removal. Also run `git log --follow` on the test file and quote the commit that added it. If that commit or its PR fixes a bug or names an issue, the test is a regression test: do not remove it.
- **Brittle test**: name the user-visible behaviour that another test still covers.
- **Behaviour that no longer exists**: show a search for the old code path (`rg`) with no hits.
- **Unused code**: show that `npm run knip` lists it, and that a search for the name across `src`, `server`, `api`, `scripts` and `tests` finds no use.
- **Doc that is wrong**: name the code it describes and show it is gone or changed.
- **Doc that is unlinked or duplicated**: show a search for links to it with no hits, or name the doc that holds the same text.
- **Filler**: the change removes or rewrites words only. It must not change code or meaning.

If any evidence is missing, do not remove the item.

## Size and count

- **At most 3 PRs per run.**
- Each PR has **one theme**: tests, dead code, or docs. Never mix themes.
- A PR that touches more than **10 files** is too big: split it or drop part of it.
- Each PR starts from the latest `main` on its own branch.
- Product code in `src/`, `server/`, `api/` and `scripts/` must not grow. Removing lines is fine. Net lines are checked in CI.
- Each PR adds a changelog file `docs/changelogs/<UTC YYYYMMDD-HHMMSS>-<slug>.md` with 1 to 5 lines.

## Measure before and after

Run these on the branch before the change and again after it. Put every number in the PR body.

| What | Command | Shows |
|---|---|---|
| Test count and unit test time | `npm run test:unit`, then `npm run test:budget` | How many tests run, and whether they stay in the time budget |
| Duplicate code | `npm run dup` | Copy-paste blocks |
| Dead code | `npm run knip` | Unused files, exports and dependencies |
| Coverage | not available | The repo has no coverage tool. Write "not measured" in the PR body. |

A lower test count needs the evidence above for each removed test. Coverage cannot be measured here, so the removal evidence is the check that nothing was lost.

## When nothing is worth removing

Close the issue with the comment "nothing to clean", and list the commands you ran with their results. This is a valid result. Do not invent work to fill the day.

## Steps of one run

1. Read the issue, this file, and the epic #255 rules.
2. Look at the commit range in the issue body. Start with the files it lists.
3. Make a list of candidates, each with its evidence. Drop any candidate without evidence.
4. Make at most 3 PRs. For each PR:
   - branch from the latest `main`;
   - add the changelog file;
   - put the evidence and the before and after numbers in the PR body;
   - a second, separate Opus subagent reads the PR diff and this file, and judges it. If it rejects the PR, close the PR and its branch. Do not leave a rejected PR open. If the fix is small, fix it and ask the subagent to judge again first;
   - only after the judgement passes, add the label `cleanup-pr`.
5. **Never merge.** Stop after the label. Shaked merges.
6. Post the Handoff on the issue and close the issue as completed.

## Standing rules that still apply

- Never use `--no-verify`. Never skip, disable or weaken a test to get green.
- Never print or commit a secret.
- Merge commits only, never squash. Update a branch by merging `main`, never by rebasing.
- Every PR has a changelog file.
- The Codex review is optional (decided on #154). Opus must judge the final head before the PR is merged.

## Who decides what

- Merging a cleanup PR is Shaked's decision (the epic's default). If he changes it, this file changes first.
- Every change to this file is reviewed by Opus before it merges.
