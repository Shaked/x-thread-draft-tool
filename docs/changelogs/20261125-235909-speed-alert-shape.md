# Speed alerts say what is over and what to do

- The speed alert says how far a merge went over its limit, since when, and how many merges in a row.
- It names the likely cause for CI checks, and links one gate issue that holds the diagnosis.

Area: Speed
Link: https://github.com/Shaked/x-thread-draft-tool/pull/467

## Technical details

Alert shape in `telegram-message.md` (section 6). `scripts/speed-metrics.mjs` walks the streak, reads the slowest Tests step against its median, and opens or updates one gate issue (`issues: write`). One alert per streak; the gate closes after 24 hours within the limits.
