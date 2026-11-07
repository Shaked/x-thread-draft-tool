# Skill: Agent Branch, PR and CI Workflow

Use this skill for any session that changes the repo: planning, a task from a plan, or a fix. It
covers scope, branches, commits, pull requests and reading CI. The helper is `scripts/agent-pr.sh`.

## 1. Scope: plan or implement
- "Plan", "review the plan", "add to our plans" → edit `docs/plans/` (+ changelog) only. No code.
- Implement only a task Shaked names (for example "do Task 1.0"). A bare "go" or "do it" applies
  to the last thing you asked about; if that was a question with more than one open item, ask which.
- A problem found while planning (red CI, a bug) becomes a task in the plan with an acceptance
  check. Offer to implement it; do not start it.
- One task per pull request. Never mix plan edits and code in one PR.

## 2. Branch
- `scripts/agent-pr.sh branch claude/<slug>` starts from the latest `origin/main`.
- Clones here are often shallow and only track `main`. `scripts/agent-pr.sh push` pushes and sets
  the upstream; without it, stop hooks report "no remote branch" even after a successful push.

## 3. Commit
- Conventional commits; no model names in commit or PR text.
- The pre-commit hook runs `npm run precommit:checks` (docs refresh, build, unit + API tests) and
  stages `claude.md`. Do not bypass it with `--no-verify`.
- Every PR adds one `docs/changelogs/YYYYMMDD-HHMMSS-<slug>.md` file (UTC).

## 4. Pull request
- `gh pr create` fails in agent sessions (GraphQL blocked). Use
  `scripts/agent-pr.sh pr "<title>" <body-file>` (REST).
- Never merge, approve, or run workflows against production without Shaked asking.

## 5. Read CI
- `scripts/agent-pr.sh checks [sha]` lists check runs; `scripts/agent-pr.sh smoke [sha]` prints
  the deployed smoke steps.
- Before blaming a PR for a red check, run `checks` on `main` too. Red on `main` = not this PR's:
  comment once on the PR with the cause, and plan or propose the fix separately.
- Deployed smoke test, by environment: Production runs everything with
  `XT_SMOKE_TOKEN_PRODUCTION`. Preview deployments run public steps only (`SKIP` on account
  steps is expected): each preview gets its own Neon branch with no smoke-test user, and
  `x-thread-draft-tool-preview.vercel.app` is a manually pinned alias. A `401` on account steps
  of a preview means the workflow lost that rule.

## Done criteria
- Branch pushed with upstream set, working tree clean.
- PR open with a changelog file; CI green on the head, or every red check explained on the PR.
