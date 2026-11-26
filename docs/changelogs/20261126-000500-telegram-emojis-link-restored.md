# Telegram messages show emojis and the deployment link again

- Every Telegram message starts with its emoji again.
- The production message has a clear link to the live site and to the commit.
- Lines that only said "nothing needed" are gone.

Area: Admin
Link: https://github.com/Shaked/x-thread-draft-tool/pull/0

## Technical details

Issue #463. `scripts/notify-telegram.mjs` adds an emoji per kind and a visible production and commit link, and drops
the "Nothing needed" lines. Golden tests: `tests/unit/notify-telegram-golden.test.js`.
