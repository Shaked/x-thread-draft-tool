# Weekly improvement review: rules for the agent

Epic #273, request 7 (Shaked, 2026-11-20): a weekly run checks what can be improved from updated APIs and
dependencies, uses the skill `.claude/skills/product-care.md`, and updates that skill in the same week when
things changed. A human approves once something is available for a change. Small changes the agent decides itself.

Task #294 wrote these rules. Task #295 added the workflow `.github/workflows/weekly-review.yml` and the check
`scripts/weekly-review-check.mjs`.

## How a run starts

- Label `weekly`, executor Opus, at most one open `weekly` issue per week. The issue body is
  `.github/weekly-review-issue.md` plus the commit list since the last run.
- Schedule: on, Mondays 05:23 UTC (owner default, 2026-11-20, epic plan O3). To make it on demand only, Shaked changes the workflow file.
- Before any run, the check (no model, no tokens) collects the signals: `npm outdated`, `npm audit`, the MCP and
  Vercel pins against npm, the Telegram Bot API version, the Node LTS against the workflow Node versions, and the
  client-matrix rows not checked for over 30 days (`node tests/eval/client-matrix.mjs --stale`).
- It hashes the signals. The hash and the signals are stored in the issue body. The next run compares its hash with
  the newest `weekly` issue. Same hash: nothing happens. A source that cannot be read keeps its last value, so it
  never opens an issue by itself.
- It opens no new issue while an earlier `weekly` issue is still open.
- Speed (task S7, #315): before the check, the workflow runs `scripts/speed-metrics.mjs --since 7d`, with the
  `speed.json` of the last successful run as `--previous` (its artifact `speed-metrics-weekly`). Missing previous
  artifact: `slower` is false for every stage, and that is not a change. The fingerprint takes two booleans per
  stage, `over` and `slower`. Seconds never enter it, so a normal week changes nothing. When a flag is set and the
  fingerprint changed, the issue body carries the `speed.md` table in a fenced block.
- Permissions added for S7: `actions: read` (download the previous artifact), `pull-requests: read` and
  `deployments: read` (the speed metrics read PRs and deployments, as `speed-metrics.yml` does). All read-only.
  The speed step has no Telegram secret, so it never sends a message. Opus validates this permission change.
- The first run after S7 opens one issue, if none is open, because the fingerprint gains the `speed` facts.

## What the run checks

1. **Skill facts.** Read `.claude/skills/product-care.md`. For each fact, check its source. Update only what was
   checked, with the source and today's date (see the skill's update rule).
2. **Protocol and client changes.** The MCP protocol versions in `server/mcp/server.js`, the pins in `package.json`,
   and the client sources in the skill. Client text changes go to every client and to both languages (AGENTS.md).
3. **Dependencies and advisories.** `npm audit` and dependency versions (`npm outdated`).
4. **Speed.** The speed check of task #306: it opens an issue only when something got slower. Speed fixes go through
   the speed rules of #306, not these.
5. **Reply style.** `.claude/skills/reply-style/` (its templates and rules) is updated in the same "skill" PR, as the
   skill itself says.
6. **pstack.** Look at https://github.com/cursor/plugins/tree/main/pstack for a version newer than 0.15.46, the one
   copied into `.claude/skills/pstack-*` (`THIRD_PARTY_LICENSES/pstack.md`). If one exists, open an issue. Never update
   the copied files on its own.

## What the agent may decide and merge

- At most **3 PRs per run**, one theme each.
- The **skill PR** (theme `skill`) updates `.claude/skills/product-care.md` and `.claude/skills/reply-style/`, with
  the findings of the run. It is the only place the skill changes.
- The agent may merge, under the standing permission, after the Opus judgement passes on the final head:
  - skill text, docs, and test fixtures that follow a published spec.
- Never merged by an agent, and labelled `owner` (Telegram "Needs you"):
  - any dependency bump, of any size;
  - any product behaviour change;
  - `npm audit` high or critical findings. The first line of the PR body says so.
  - a change to a limit, a gate, or a test (test fixtures that follow a published spec excepted). AGENTS.md: a limit change is for Shaked.

## Rules that still apply

- Shaked's decisions are recorded on the epic with the date. "continue" is not an approval.
- Never use `--no-verify`. Never skip, disable or weaken a test to get green.
- Merge commits only. Update a branch by merging `main`, never by rebasing.
- Every PR adds a changelog file `docs/changelogs/<UTC YYYYMMDD-HHMMSS>-<slug>.md` (1 to 5 lines).
- The Codex review is optional (#154). Opus judges the final head before a merge.
- The Handoff goes on the `weekly` issue (template: `.claude/skills/reply-style/templates/handoff.md`), then the
  issue is closed as completed.

## Who decides what

- Owner decisions in this run go on the epic #273 with the date, one question per comment, each with a default.
- Every change to this file is judged by Opus before it merges.
