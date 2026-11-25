# Speed alert shows what is over

- The Telegram speed alert names each stage over its limit, with its p90, its limit, its usual value and the merged pull requests it covers.
- The alert says nothing is needed, because the speed check only warns.

Area: Speed
Link: https://github.com/Shaked/x-thread-draft-tool/pull/442

## Technical details

`overLines` in `scripts/speed-metrics.mjs` builds the stage lines from the same summary the check uses; `speedMessage` in `scripts/notify-telegram.mjs` formats them. Limits are unchanged.
