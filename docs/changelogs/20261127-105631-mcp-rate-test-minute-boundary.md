# Rate-limit test stops flaking at minute change

- The tool-call rate-limit test no longer fails when a minute ends during the test.

Area: AI apps
Link: https://github.com/Shaked/x-thread-draft-tool/pull/600

## Technical details

`tests/api/mcp-rate.test.js` reads the newest count row, not the row for the current minute. Issue #594.
