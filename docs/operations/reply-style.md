# Reply style

Agents write every reply to Shaked, every HANDOFF and every owner question with a fixed template,
so a reply makes sense without the agent's context. Owner request of 2026-11-21, task #353.

- The skill is the reply-style plugin's skill, used here in place: `.claude/skills/reply-style` is a symlink to
  `plugins/reply-style/skills/reply-style/` ([`SKILL.md`](../../plugins/reply-style/skills/reply-style/SKILL.md)). It says
  which template to use and holds the hard rules.
- **Edits go to `plugins/reply-style/`, never through the symlink or the GitHub web editor.** Every PR that changes a file
  under `plugins/reply-style/` bumps the version in `plugin.json` and the marketplace entry and adds a section to the plugin
  `CHANGELOG.md` (the plugin manifests check enforces it). The weekly review edits the skill the same way.
- This repo's settings are in `.claude/agent-kit.json`: the owner name, the `Implements #n Task n` line, the changelog areas,
  the project templates and the writing skills. `scripts/reply-lint.mjs`, `scripts/reply-style-stop.mjs` and
  `scripts/reply-lint-comment.mjs` are wrappers that run the plugin code with that file.
- The plugin templates: [`plugins/reply-style/skills/reply-style/templates/`](../../plugins/reply-style/skills/reply-style/templates/):
  status report, owner question, handoff, owner action, incident. The handoff keeps `## Models` and the last line `RELEASE`,
  because the dispatcher rules (#154) name `.claude/skills/reply-style/templates/handoff.md`.
- The project templates, in [`.claude/reply-style-templates/`](../../.claude/reply-style-templates/) and listed under
  `reply-style.extraTemplates`: `changelog-entry` (`docs/changelogs/<UTC YYYYMMDD-HHMMSS>-<slug>.md`, shown in the app),
  `telegram-message` (sent by `scripts/notify-telegram.mjs`), `janitor-summary` (a comment on #497, written by
  `scripts/session-janitor.mjs report`) and `status-board` (`/status`, made by `scripts/status-board.mjs`).
  Apply `pstack-unslop` and `pstack-technical-writing` to the changelog and Telegram ones. A changelog entry is a `#` title of
  3 to 8 words that says what changed for a person, then 1 to 5 short lines; the app shows the title and the first three lines,
  cut at 280 characters. Plain words only: no issue numbers, task ids, file names or code spans. A Telegram message is one
  message per event, at most 5 lines; line 1 is one emoji, the app name in bold, ` · ` and the linked headline
  (issue #504), then the item, one fact, `Needs you:` with one action, and links. Never a secret, a login name, draft text or
  log output ([`telegram.md`](telegram.md)). Check them with `npm run reply-lint -- --kind=changelog <file>` or `--kind=telegram <file>`.
- Adding or changing a template or a rule needs a lint rule named in `RULES` (in the plugin lint), golden fixtures (a `good-*.md` and,
  for every rule, a `bad-*.md`, with `WANT` in the golden tests) and the rule by name in "Before you send" of the skill. The tests fail
  when one is missing, and when a template has no fixture folder. Keep new rule text generic: no product name or person's name.
- Every template starts with the same headings: `TL;DR`, `What you need to do`, `Waiting for`,
  `Blocked on you`, `Done`, then an optional `Details`. "Blocked" is only ever a human.
- The lint: `npm run reply-lint -- reply.md` (`scripts/reply-lint.mjs`, the plugin lint with this repo's settings). It flags bare labels such
  as `#273` or `Q1` with no words saying what they are, options named A, B or C, "unchanged",
  "blocked" used for a machine, long lines, emoji, filler phrases, and missing headings.
- CI runs the lint on every PR body, warn only for now (`.github/workflows/reply-lint.yml`).
- The slop and writing checks are three skills from pstack (MIT, by Lauren Tan), copied into
  `.claude/skills/pstack-unslop`, `pstack-technical-writing` and `pstack-bro`. Source and licence:
  [`THIRD_PARTY_LICENSES/pstack.md`](../../THIRD_PARTY_LICENSES/pstack.md).
- Every session finds the rule: it is at the top of `AGENTS.md`, and `CLAUDE.md` points to it.
- Updates: the weekly improvement review (#294) edits the plugin skill in the same run as its findings (version bump included),
  and opens an issue when pstack has a newer version. It never updates the vendored pstack files on its own.
- Golden tests (#486): `tests/unit/reply-lint-golden.test.js` runs fixtures in
  `tests/unit/fixtures/reply-lint/golden/<kind>/`. Each kind has `good-*.md` files that pass and
  `bad-*.md` files that fail for exactly the rules the test names (`WANT` in the test maps each file name to its rules). A kind without fixtures fails the test.
  The rules `loose-label` (a `**Done:**` line instead of the heading) and `empty-details` came from that issue.
- Stop hook (#486): `.claude/settings.json` runs `plugins/reply-style/scripts/reply-style-stop.mjs` (`scripts/reply-style-stop.mjs` wraps it for tests) when a turn ends. It lints
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
