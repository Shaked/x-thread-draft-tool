# Owner Telegram messages say what happened first

- Each Telegram message starts with a bold headline that links to the page, then one short action line.
- The messages have no emoji and use the same words for production, preview and PR.

Area: Admin
Link: https://github.com/Shaked/x-thread-draft-tool/pull/PENDING

## Technical details

Plan #369 step 7. `scripts/notify-telegram.mjs` sends the forms in `.claude/skills/reply-style/templates/telegram-message.md`,
one golden test per form in `tests/unit/notify-telegram.test.js`. The speed kind keeps its text. The "What it removes" line
shows for the cleanup label (the label workflow passes the PR body); the "What changed" line of the preview message does not
show, as before (see `docs/operations/telegram.md`).
