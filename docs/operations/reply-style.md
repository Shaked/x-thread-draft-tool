# Reply style

Agents write every reply to Shaked, every HANDOFF and every owner question with a fixed template,
so a reply makes sense without the agent's context. Owner request of 2026-11-21, task #353.

- The skill: [`.claude/skills/reply-style/SKILL.md`](../../.claude/skills/reply-style/SKILL.md).
  It says which template to use and holds the hard rules.
- The templates: [`.claude/skills/reply-style/templates/`](../../.claude/skills/reply-style/templates/):
  status report, owner question, handoff, owner action, incident.
- Every template starts with the same headings: `TL;DR`, `What you need to do`, `Waiting for`,
  `Blocked on you`, `Done`, then an optional `Details`. "Blocked" is only ever a human.
- The lint: `npm run reply-lint -- reply.md` (`scripts/reply-lint.mjs`). It flags bare labels such
  as `#273` or `Q1` with no words saying what they are, options named A, B or C, "unchanged",
  "blocked" used for a machine, long lines, emoji, filler phrases, and missing headings.
- Updates: the weekly improvement review (#294) edits the skill in the same run as its findings.
