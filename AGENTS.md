# Agents

## Using the product as an agent
JSON API with a personal API token. Start at `/llms.txt` or `/api/openapi.json`; details in docs/agents/api.md.

## Working in this repo
### Where the work is
- The queue is the one open issue labelled `dispatch`. Epics are issues labelled `epic`; each task is a sub-issue labelled `task` with its full plan. There are no plan files.
- One session does one task: claim, build, ship, post the Handoff comment, end. Templates are in the queue issue.
- Record every decision Shaked makes in the epic, with the date. "continue" is not an approval.

### Rules
- Check a fact before you state it; otherwise write "not checked".
- Smallest change that does the job. One task per PR, on its own branch from the latest `main`.
- Never commit with `--no-verify`. Never skip, disable or weaken a test. Never print or commit a secret.
- Never sleep-poll. Schedule one wake-up and end the turn.
- A test must run without a person.
- Deployed checks only in GitHub Actions or with Vercel's fetch tool on https://x-thread-draft-tool-preview.vercel.app. Never fetch production with it.

### Shipping (standing permission from Shaked)
- For every queued task: open the PR, merge when checks are green and Opus approved, let it deploy, check production, post the Handoff. Do not ask. Never hold a finished task.
- When Shaked said to do something, do it; if his words can mean two things, take the likelier, act, say which.
- Merge commits only, never squash. Update a branch by merging `main`, never rebase.
- Every PR adds `docs/changelogs/<UTC YYYYMMDD-HHMMSS>-<slug>.md` (1 to 5 lines).
- Net lines: product code in `src/ server/ api/ scripts/` must not grow unless the PR body says `Implements <plan reference> Task <n>` (see Q3 for the accepted forms).
- `npm ci` once; the pre-commit hook runs build and unit tests.
- Test files under `tests/api/` start with `// @vitest-environment node`.
- GitHub work through the GitHub MCP tools; `gh` for search only. Every comment ends with the Claude Code footer.
- After every push, comment `@codex review`. Codex answers in 2 to 3 minutes as a PR comment. Check at 3 min, ask again at 10, treat it as silent at 15. The `Codex review` check stays red while any Codex thread is unresolved; when the fix is on the head, reply and resolve.

### Models
- Haiku executes every task. The task names its validator: Opus for SQL, auth, security, data deletion and design; Sonnet for other code. Opus judges every PR before merge.
- Design doubts go to Opus, never to Shaked. If Haiku fails the same step twice, Sonnet does that step.
- Owner-only: money, secrets, deleting data, product behaviour the task does not decide. Label `owner`, note it, keep working.
- Every Handoff says which model did what.

### Talking to Shaked
- First line: what is done. Then what is not done and why. Then the one thing that unblocks it.
- Simple technical English, short sentences, no internal labels without a few words saying what they are (`T2 thread view`, `#76`).
- Ask only what Shaked alone can decide: what is decided (as the user sees it), each option's result, your recommendation and what you do if nobody answers.
- For a manual step: what to click, where (link), what it unblocks, and which automated route failed.
