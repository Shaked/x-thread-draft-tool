# Reply style

Agents write every reply to Shaked, every HANDOFF and every owner question with a fixed template,
so a reply makes sense without the agent's context. Owner request of 2026-11-21, task #353.

- The skill: [`.claude/skills/reply-style/SKILL.md`](../../.claude/skills/reply-style/SKILL.md).
  It says which template to use and holds the hard rules.
- The templates: [`.claude/skills/reply-style/templates/`](../../.claude/skills/reply-style/templates/):
  status report, owner question, handoff, owner action, incident, and two more for changelog
  entries and Telegram messages.
- Every template starts with the same headings: `TL;DR`, `What you need to do`, `Waiting for`,
  `Blocked on you`, `Done`, then an optional `Details`. "Blocked" is only ever a human.
- The lint: `npm run reply-lint -- reply.md` (`scripts/reply-lint.mjs`). It flags bare labels such
  as `#273` or `Q1` with no words saying what they are, options named A, B or C, "unchanged",
  "blocked" used for a machine, long lines, emoji, filler phrases, and missing headings.
- CI runs the lint on every PR body, warn only for now (`.github/workflows/reply-lint.yml`).
- The slop and writing checks are three skills from pstack (MIT, by Lauren Tan), copied into
  `.claude/skills/pstack-unslop`, `pstack-technical-writing` and `pstack-bro`. Source and licence:
  [`THIRD_PARTY_LICENSES/pstack.md`](../../THIRD_PARTY_LICENSES/pstack.md).
- Every session finds the rule: it is at the top of `AGENTS.md`, and `CLAUDE.md` points to it.
- Updates: the weekly improvement review (#294) edits the skill in the same run as its findings,
  and opens an issue when pstack has a newer version.
- Golden tests (#486): `tests/unit/reply-lint-golden.test.js` runs fixtures in
  `tests/unit/fixtures/reply-lint/golden/<kind>/`. Each kind has `good-*.md` files that pass and
  `bad-*.md` files that fail for exactly the rules the test names (`WANT` in the test maps each file name to its rules). A kind without fixtures fails the test.
  The rules `loose-label` (a `**Done:**` line instead of the heading) and `empty-details` came from that issue.
- Stop hook (#486): `.claude/settings.json` runs `scripts/reply-style-stop.mjs` when a turn ends. It lints
  `last_assistant_message` with the template checks and, on a failure, returns `{"decision":"block","reason":...}`
  with the failing rules, so the agent rewrites the reply. A second pass (`stop_hook_active`) is never blocked.
  **How a session opts in:** the variable `REPLY_STYLE=owner` is in the session's environment when it starts. A local
  session: `REPLY_STYLE=owner claude`. A cloud session: add `REPLY_STYLE` with the value `owner` to the environment the session
  runs in (an environment variable, not a secret). A scheduled task that starts a fresh cloud session uses its environment.
  Today no session opts in (checked 2026-11-26: the repo and the Default cloud environment set no `REPLY_STYLE`), so the hook
  does nothing until the owner or the dispatcher's environment sets it. In an opted-in session every turn end is linted, so a
  short turn that is not in the template ("Done.") is sent back once and costs one extra turn. Test: `tests/unit/reply-style-stop.test.js` (pass and fail, no model).
- Agent comments on GitHub (#486): `.github/workflows/reply-lint-comments.yml` runs `scripts/reply-lint-comment.mjs` on each new
  or edited comment that ends with the Claude Code footer and starts with `HANDOFF`, `Decision`, a question or the template heading `## TL;DR`. A `Decision` comment gets the word rules only (no headings required). A failure turns the
  run red and adds the label `reply-style-fail` to the issue or PR. Why a label: a check run attaches to a commit, so it cannot
  show on a tracker issue; the label is visible there and the janitor reports every open issue that carries it. The job lints only the comment that triggered it,
  so old comments do not turn it red.
- Janitor (#486): `scripts/janitor.mjs report` lints the newest 10 HANDOFF comments in the `--comments` file and lists each
  failure with its link under "Reply style".
- Session links and tested templates (#521): a `Waiting for` item that names a session carries its session link next to the task link
  (`[session](https://claude.ai/code/session_<id>)`), enforced by the rule `session-link`; opening the link in the Claude app is not checked.
  The skill section "Adding or changing a template" requires a lint rule, golden fixtures and a "Before you send" entry, and
  `tests/unit/reply-lint-golden.test.js` fails when a template has no fixtures or a rule has no failing fixture. The Stop hook and the
  comment lint both call `lint()`, so they cover every new rule; `tests/unit/reply-style-stop.test.js` checks `session-link` through the hook.
