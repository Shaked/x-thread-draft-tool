# Agents

## Using the product as an agent

The app is fully usable through a JSON API with a personal API token. Start with `/llms.txt`
or `/api/openapi.json`, and read [docs/agents/api.md](./docs/agents/api.md). The tests in
levels 1 and 2 run in any sandbox, without a person.

## Working in this repo

Read this at the start of every session and after every context summary.

### Work
- Read the task's plan section in full. Do the next step only.
- Check a fact before you state it (`date -u`, the PR, the check, the log). Otherwise say "not checked".
- Smallest change that does the job. One task per PR. Branch from the latest `main`.
- Never commit with `--no-verify`. Never skip, disable or weaken a test. Never print or commit a secret.
- Never `sleep`-poll or re-check the same thing in one turn. Schedule one wake-up and end the turn.
- A test must run without a person. If it needs someone to sign in or click, redesign it.

### Standing permissions (Shaked gave these; never ask for them again)
- For every task in the current plan: open the PR, merge it when the checks are green and Opus
  approved it, and let it deploy to production. Do these without asking.
- Each task ships on its own. When a task's PR is ready, merge it and check production before
  you start the next task. Never hold a finished task until other tasks are done.
- When Shaked has said to do something, do it. Do not ask him to confirm it or to reply with a
  phrase. If his words can mean two things, take the more likely one, act, and say which you took.

### Models
- The plan names who executes (default: Haiku). Opus judges every PR before merge.
- In doubt, ask Opus. Do not guess, and do not ask Shaked a design question.
- Use Sonnet when Haiku failed the same step twice or the step is too large for it.
- Opus does not decide owner-only matters: money, secrets, deleting data, product behaviour the plan does not already decide.
- Say in your reply which model did what.

### Trackers
- One GitHub issue per plan (an epic). It lists the tasks, the decisions with dates, and what
  is needed from Shaked. Close it when the plan is done. Never reuse it for other work.
- Record every decision Shaked makes in the epic, with the date. A "continue" is not an approval.

### Talking to Shaked
- First line: what is done. Then what is not done and why. Then the one thing that unblocks it.
- Simple technical English. Short sentences. No internal labels (D-14, P-CODEX, O8) unless the
  same line says what the label means.
- Ask a question only when Shaked alone can decide it and he has not already said it. Decide
  the rest yourself and say what you chose. Keep working on everything the question does not block.
- Write each question so it can be answered without reading anything else:
  1. What is being decided, in one sentence, in terms of what a user sees.
  2. Each option: what happens if Shaked picks it.
  3. Your recommendation, the reason, and what you will do if nobody answers.
- When Shaked must do something by hand: what to click, where (link), and what it unblocks.
  Say which automated route you checked and why it does not work.
- Number tasks and PRs (`T2`, `#76`), and add two or three words that say what the item is.

### Codex review
- After every push, comment `@codex review`. Codex answers in 2 to 3 minutes as a PR comment,
  not a review, so a missing review means nothing. Check after 3 minutes, ask again at 10,
  treat it as silent at 15.
- The `Codex review` check stays red while any Codex thread is unresolved, even an outdated
  one. When the fix is on the head, reply on the thread and resolve it.

### Repo specifics
- Merges to `main` are merge commits, never squash. Update a stacked branch by merging `main` into it, never by rebasing.
- Net lines: product code in `src/`, `server/`, `api/` and `scripts/` must not grow overall (tests and docs
  do not count). If it grows, the PR body must name a plan task as `docs/plans/<file>.md Task <number>`,
  for example `Implements docs/plans/performance.md Task 1 (P1)`. Otherwise the `Net lines` check fails.
- Every PR adds `docs/changelogs/<UTC YYYYMMDD-HHMMSS>-<slug>.md` (1 to 5 lines).
- The pre-commit hook runs build and unit tests: `npm ci` once, then commit normally.
- A test file under `tests/api/` starts with `// @vitest-environment node` (the default is jsdom).
- GitHub work goes through the GitHub MCP tools; `gh` only for search. Every comment ends with
  the Claude Code footer.
- Deployed checks run in GitHub Actions or with Vercel's fetch tool on
  `https://x-thread-draft-tool-preview.vercel.app`. Never fetch production with it.
- Current plan: [docs/plans/private-drafts-share-links.md](./docs/plans/private-drafts-share-links.md), epic #111.
