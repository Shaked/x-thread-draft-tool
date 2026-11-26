# Agents

## Replies to Shaked (every session, every tool)
Every reply to Shaked, every HANDOFF, every owner question and every PR or issue comment meant for him uses `.claude/skills/reply-style` (`SKILL.md` and its templates; it is a symlink into `plugins/reply-style/`, so edit the plugin and bump its version) and passes `npm run reply-lint` before it is posted.

## Using the product as an agent
JSON API with a personal API token. Start at `/llms.txt` or `/api/openapi.json`; details in docs/agents/api.md.

## Working in this repo
### Where the work is
- The queue is the one open issue labelled `dispatch`. Epics are issues labelled `epic`; each task is a sub-issue labelled `task` with its full plan. There are no plan files.
- One session does one task: claim, build, ship, post the Handoff comment, end. The CLAIM template is in the queue issue; the HANDOFF template is in the `reply-style` skill.
- Record every decision Shaked makes in the epic, with the date. "continue" is not an approval.
- An open issue labelled `cleanup` is an eligible task of the Daily cleanup review epic (#255): executor Opus, at most one per day, and the session never merges. Rules: `docs/operations/cleanup-review.md`.
- An open issue labelled `weekly` is a task of the weekly improvement review: executor Opus, at most one per week; rules in `docs/operations/weekly-review.md`.

### Rules
- Check a fact before you state it; otherwise write "not checked".
- UI work: read `ui-debug` first (`.claude/skills/ui-debug/SKILL.md`; `/ui-debug`).
- Smallest change that does the job. One task per PR, on its own branch from the latest `main`.
- Never commit with `--no-verify`. Never skip, disable or weaken a test. Never print or commit a secret.
- Never sleep-poll. Schedule one wake-up and end the turn.
- A test must run without a person.
- Deployed checks only in GitHub Actions or with Vercel's fetch tool on https://x-thread-draft-tool-preview.vercel.app. Never fetch production with it.
- UI, API and MCP stay aligned: a new or changed capability goes to all three surfaces in the same PR, or its row in `docs/architecture/capabilities.md` says `no: <reason>` for that surface. One server function per capability; MCP tools call the REST route in-process and the UI calls the same REST route.
- Every AI app and both languages: a change that a client or an assistant will see or use (server instructions, tool or prompt text, results, views and cards, slash commands, skills, plugin or connector metadata, docs for connecting) is made for every supported client (Claude, ChatGPT, Grok, and any other client in the matrix) and for both languages (English and Hebrew) in the same PR, or its row in `docs/architecture/client-matrix.md` says `no: <reason of 3 words or more>` or `not checked` for that cell. Add or update an eval for it.

### Shipping (standing permission from Shaked)
- For every queued task: open the PR, merge when checks are green and Opus approved, let it deploy, check production, post the Handoff. Do not ask. Never hold a finished task.
- A merge whose changed files are all skipped by `scripts/vercel-ignore.mjs` (`docs/`, `.github/`, `tests/`, `.claude/`, `.githooks/`, any `.md`) creates no deployment: the production check is "no deployment created; production still runs <sha>, last smoke green". Do not wait for a smoke run.
- When Shaked said to do something, do it; if his words can mean two things, take the likelier, act, say which.
- Merge commits only, never squash. Update a branch by merging `main`, never rebase.
- Every PR adds `docs/changelogs/<UTC YYYYMMDD-HHMMSS>-<slug>.md` (1 to 5 lines).
- Net lines: product code in `src/ server/ api/ scripts/` must not grow unless the PR body says `Implements docs/plans/<file>.md Task <n>` or `Implements #<issue> Task <n>` (`<n>` may start with one capital letter: `Task R0`).
- `npm ci` once; the pre-commit hook runs build and unit tests.
- Test files under `tests/api/` start with `// @vitest-environment node`.
- GitHub work through the GitHub MCP tools; `gh` for search only. Every comment ends with the Claude Code footer.
- A speed gate or budget check that is over its limit is not a stop. Opus diagnoses it first: which stage, the slowest runs, the cause, and one fix with the expected saving. Opus posts that on the gate's issue (the weekly speed issue, or a new issue labelled `task` if there is none). Then Haiku opens the fix PR (Sonnet if Haiku fails the same step twice); Opus validates it; the same check runs again after merge. Up to 2 fix PRs per gate. If the gate is still over after 2 fix PRs, label the issue `owner` with the diagnosis and the measured before and after, and keep working. Never raise a limit, skip or quarantine a test, or change the measurement to pass the gate. A limit change, or a product behaviour change, is for Shaked (label `owner`).
- Codex review is optional (decided by Shaked 2026-11-19, #154). After a push you may comment `@codex review`. If Codex says its usage limit is reached, or the `Codex review` check is red only for that reason, do not wait and do not ask Shaked: merge when CI is green and Opus has validated and judged the PR on the final head (if a commit comes after Opus read it, Opus re-reads it first). Say "Codex not available (limit); Opus validated" in the Handoff. If Codex does review, read its comments and resolve its threads once the fix is on the head. This does not weaken any test, the Opus review or the production smoke check.

### Models
- Haiku executes every task. The task names its validator: Opus for SQL, auth, security, data deletion and design; Sonnet for other code. Opus judges every PR before merge.
- Design doubts go to Opus, never to Shaked. If Haiku fails the same step twice, Sonnet does that step.
- Owner-only: money, secrets, deleting data, product behaviour the task does not decide. Label `owner`, note it, keep working.
- Every Handoff says which model did what.

### Talking to Shaked
- Reply format: see "Replies to Shaked" at the top of this file.
- When you ask Shaked to try something on preview, add the label `try-preview` to the PR (he gets a Telegram message with the link if the label comes from his account; see the guide). When something only he can do exists, add the label `owner`. Details: `docs/operations/telegram.md`.
