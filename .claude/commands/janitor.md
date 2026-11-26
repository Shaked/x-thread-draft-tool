---
description: Run the task janitor (pass 1, issues) and pass 2 (Claude sessions matched with issues), post the templated summary on the Janitor reports issue, and apply only the allowed fixes.
---

Run the janitor. Follow `.claude/skills/task-janitor/SKILL.md` ("Run both passes"); in short:

1. Snapshot: `node scripts/janitor.mjs fetch > snapshot.json` in your scratchpad.
2. Sessions: dump every page of `list_sessions` into `sessions.json` (skill, "Pass 2", step 1). Say how many sessions
   and pages you read.
3. Comments and PR checks: `node scripts/session-janitor.mjs need sessions.json snapshot.json`, and the issues pass 1
   asks for. Save `comments.json` and `pulls.json`.
4. Reports: `node scripts/janitor.mjs report snapshot.json --comments comments.json > pass1.txt`, then
   `node scripts/session-janitor.mjs findings ...` to read the findings.
5. Apply only the allowed fixes (skill, "Act on the report"), and write each one you checked in `applied.json`.
   Before you close an issue for a pass 2 `done-open` that is `allowed`, read its last HANDOFF yourself (done, RELEASE)
   and check that its PR is merged.
   For a duplicate pair, pass 2's `duplicate-issue` finding wins: when it says `dispatcher`, close nothing.
6. `node scripts/session-janitor.mjs report sessions.json snapshot.json --comments comments.json --pulls pulls.json
   --applied applied.json --pass1 pass1.txt > summary.md`, then `npm run reply-lint -- --template summary.md`.
   The command prints the size; over 60 000 characters, leave out `--pass1` and post `pass1.txt` as a second comment.
7. Post `summary.md`, with the Claude Code footer, as a comment on #497 (Janitor reports tracker issue).

Never delete anything, never archive a session that is not completed, never close unfinished work, never print a
secret or a session token. Do not resume or message sessions: list them for the dispatcher.
