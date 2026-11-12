# Agents

## Using the product as an agent

The app is fully usable through a JSON API with a personal API token. Start with `/llms.txt`
or `/api/openapi.json`, and read [docs/agents/api.md](./docs/agents/api.md) for auth, every
endpoint, limits and how to test (unit, local headless server, deployed smoke test).
Agents never need a human to run the tests: levels 1 and 2 run in any sandbox.

## Working in this repo

Short on purpose. Read it at the start of every session and after every context summary.

### General
- Read the task's plan section in full before you change anything. Do the next step only.
- Check facts before you state them: run `date -u` for the time; read the PR, check or log instead of
  guessing. Say "not checked" when you have not checked.
- Smallest change that does the job. One task per PR. Branch from the latest `main`.
- Never commit with `--no-verify`. Never skip, disable or weaken a test to get green.
- Never print, paste or commit a secret.
- Waiting: never `sleep`-poll and never re-check the same thing in one turn. Schedule one wake-up and
  end the turn.

### Reporting to Shaked (owner)
- Number every item: task numbers (for example `Task 34`), ledger items (`O1` to `O15`) and PR numbers (`#76`). Never refer to a step by description alone.
- When something needs Shaked, answer in this template, with one line on what is done first:

  ```
  Done: <one line>

  ## Needs from you
  | # | Item | What to do | Link | Unblocks |
  |---|------|------------|------|----------|
  | O1 | ... | ... | <url> | ... |
  ```

  List every open owner item from the ledger, not only the new ones. Link each PR or issue.
- Record every decision Shaked makes in the ledger (issue #60) with the date. A silent "continue" is not an approval.
- Never ask Shaked a question in chat when the answer belongs in the ledger; write it as an owner item instead.

### Codex review (the rule people forget)
- **Codex answers in 2 to 3 minutes**, not 10 or 30. After `@codex review`, check again after 3
  minutes. Ask once more at 10 minutes; at 15 minutes with no answer, treat it as silent.
- Codex's answer is a **PR comment** ("Didn't find any major issues", or a summary with
  `codex-review-state`). Read PR comments, review threads and check runs. A missing *review* means
  nothing.
- The `Codex review` check stays red while any Codex finding thread is unresolved, even an outdated
  one. When the fix is on the head, reply on the thread and resolve it.

### Repo specifics
- Merges to `main` use merge commits, never squash. A stacked branch is updated by merging `main`
  into it, never by rebasing.
- Every PR adds `docs/changelogs/<UTC YYYYMMDD-HHMMSS>-<slug>.md` (1 to 5 lines).
- The pre-commit hook runs build and unit tests: `npm ci` once, then commit normally.
- A test file under `tests/api/` starts with `// @vitest-environment node` (the default is jsdom).
- GitHub work goes through the GitHub MCP tools; `gh` only for search. Every comment ends with the
  Claude Code footer.
- Deployed checks run in GitHub Actions or with Vercel's fetch tool on the stable preview
  `https://x-thread-draft-tool-preview.vercel.app`. Never fetch production with it.
- Current runbook: [docs/plans/hardening-finish-part2.md](./docs/plans/hardening-finish-part2.md).

