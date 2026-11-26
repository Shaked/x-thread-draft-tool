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
  `bad-<rule>.md` files that fail for the rule the test names. A kind without fixtures fails the test.
  The rules `loose-label` (a `**Done:**` line instead of the heading) and `empty-details` came from that issue.
