# Test shards take about the same time

- The unit and API tests run in three parts of about equal length, so the slowest part stays under its time limit.

Area: Speed
Link: https://github.com/Shaked/x-thread-draft-tool/pull/606

## Technical details

`vitest.config.js` sets `tests/shard-sequencer.mjs` as the sequencer for `--shard=n/m`. Files go out slowest first, by the per-file times in `tests/shard-timings.json` (median of three full local runs), to the shard with the least time. Vitest's default split by path hash gave one shard 12 to 16 s more file time than another (#605). Test: `tests/unit/shard-sequencer.test.js`. Limits, timeouts and tests are unchanged.
