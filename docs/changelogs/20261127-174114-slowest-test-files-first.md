# Unit test shards run the slowest files first

- Each unit test shard now starts its slowest files first, and the shard timing table has the new files.
- No change for people using the app.

Area: Docs
Link: https://github.com/Shaked/x-thread-draft-tool/issues/605

## Technical details

`TimedShardSequencer.sort` in `tests/shard-sequencer.mjs` orders each shard by the time in `tests/shard-timings.json`, keeping vitest's group and project order. The table was rebuilt with `npm run shard-timings` (193 files, one was missing). Test: `tests/unit/shard-sequencer.test.js`.
