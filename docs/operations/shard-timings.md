# Shard timings table

The unit and API tests run in four `--shard=n/4` jobs of the Tests workflow (three until #634). Two tables in
`tests/` decide which file runs where:

- `tests/shard-timings.json`: each test file's worker time in milliseconds (environment setup, setup, import,
  collect and tests), measured in CI. The committed table is the median of the CI runs of PR #635 that carried
  `test-budget-file:` lines (3 runs, 12 shard jobs; the first commit of the table was a single run). Only logs from
  that PR onward carry those lines. Refresh it after about 5 to 20 runs on `main`, which the command below does. A file missing from it counts as the table's median, and the
  sequencer prints a warning in the CI log that names it.
- `tests/shard-assignment.json`: `{ "shards": 4, "files": { "<file>": <shard 1-4> } }`. The sequencer
  (`tests/shard-sequencer.mjs`) keeps every file in its pinned shard. A file with no pin (a new test file) goes
  slowest first to the shard with the least time so far. An assignment made for another shard count is ignored.

Because the assignment is pinned, editing a time, adding a file or removing a file moves no other file. Only the
refresh script rebalances, and it moves a file only when that lowers the heaviest shard, until the heaviest and the
lightest shard are within 1 % (`tests/shard-balance.mjs`). A 50 % change to one entry moves up to 6 files, not dozens.
Inside a shard the files run slowest first (`slowestFirst` in the same sequencer).

## Why four shards (#634)

From the `test-budget:` lines of the last 30 Tests runs (90 shard jobs, 2026-11-27 and 2026-11-28, three shards):

- Shard wall time was 32.0 to 54.1 s (median 39.8 s, 90th percentile 51.2 s); 5 of 90 jobs were over the 52 s limit and
  21 were over 49 s.
- Almost all of that is runner speed, not the split. The same files took 0.64x to 1.16x of their table time in
  different jobs (median 0.84x). The same file ran up to 2x slower in one job than in another (median max/min 2.0 for
  files above 800 ms). Within one run the three shards differed by 12.8 s at the median and 19.5 s at the most.
- Wall time follows the work in the shard (summed file time / wall time stayed 1.44 to 1.75), so only less work per
  shard helps. Three shards at about 40 s cannot stay 3 s under 52 s when a runner is 1.35x slower; four shards at
  about 30 s can (1.35 x 30 = 41 s). The limits (52 s a shard, 5000 ms a file) are unchanged.
- The table was a developer machine's time (known limit in #605); in CI, files such as `mcp-prompts` and `mcp-images-parallel`
  cost 25 to 45 % more than their entries, which is why shards 1 to 3 landed 0.2 to 4 s from the limit.

## Who refreshes it, and when

- Calibrate from CI, not from a laptop: `npm run shard-timings:ci` (`scripts/ci-shard-timings.mjs`) reads the
  `test-budget-file: <ms> <file>` lines that every unit shard prints (`scripts/test-budget.mjs`) from the job logs of
  the last 20 Tests runs through `gh api`, keeps each file's median, and writes both tables. Options:
  `--runs=20 --shards=4 --branch=main --event=push --dry-run`, or `--logs=<dir>` for logs you downloaded.
- The refresh drops a test file that is not on disk any more (deleted or renamed) from both tables and says so. The
  sequencer warns in the CI log about a pinned file that is gone.
- Do it once a month, or when the CI log shows a `shard-sequencer:` warning, or when the guard test
  `keeps the committed shard totals within 3 percent of each other` fails.
- A PR that adds or removes a test file does not have to touch the tables: the new file is placed on the lightest
  shard. Refresh later with the command above.
- `npm run shard-timings` still exists for a local machine (three full local runs); local times are not CI times.

## What to check after a refresh

- `git diff --stat tests/shard-assignment.json` shows a handful of lines, not dozens.
- The four CI shards stay at least 3 s under 52 s on five runs in a row; the check is the `test-budget:` line of each
  shard job. Do not raise a limit or change the budget to hide a slow shard.
- The Tests workflow log shows no `shard-sequencer:` warning.
