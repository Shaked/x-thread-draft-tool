# Unit test shards stop failing at the edge

- The unit tests now run in four shards instead of three, so one slow CI runner no longer pushes a shard over its 52 s budget.
- No change for people using the app.

Area: Speed
Link: https://github.com/Shaked/x-thread-draft-tool/issues/634

## Technical details

Four `Unit tests shard n/4` jobs behind the unchanged required check `Unit tests (vitest)`. The split is pinned in `tests/shard-assignment.json` (a time edit or a new file moves no other file). `npm run shard-timings:ci` rebuilds `tests/shard-timings.json` from the `test-budget-file:` lines in CI logs (median of the CI runs it reads; the committed table is the median of 3 runs of this PR) and rebalances with few moves. Limits unchanged. Tests: `tests/unit/shard-sequencer.test.js`, `tests/unit/ci-shard-timings.test.js`.

Screenshot: not needed, CI only
