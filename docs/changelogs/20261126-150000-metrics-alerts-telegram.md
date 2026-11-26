# Three metrics alerts reach Telegram

- The owner now gets one Telegram message when errors, slow answers or database capacity go over their limits, and again only after 24 hours clear.

Area: Operations
Link: https://github.com/Shaked/x-thread-draft-tool/issues/338

## Technical details

`server/metrics/alerts.js` runs in the daily step; the `alerts` job of `metrics-daily.yml` sends kind `metrics` with `scripts/notify-telegram.mjs`. Implements #331 Task 7.
