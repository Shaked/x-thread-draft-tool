# Shard timings table

`tests/shard-timings.json` holds each test file's worker time in milliseconds (environment setup, setup,
import, collect and tests). `tests/shard-sequencer.mjs` uses it to split the unit and API tests into the three
`--shard=n/3` jobs of the Tests workflow (#605). A file missing from the table counts as the table's median,
and the sequencer prints a warning in the CI log that names it.

Inside a shard the files run slowest first (`sort()` in the same sequencer), so the longest file never starts last.

## Who refreshes it, and when

- The author of a PR that adds or removes a test file runs `npm run shard-timings` (about 5 minutes; three
  full runs on the local machine) and commits the table with that PR. If the author does not, the next
  person to see the warning in the CI log does it.
- Once a month, or after a PR that changes many test files, the same command runs again.
- The script keeps the median of the runs, so a single slow run does not move the table much.

## What to check after a refresh

- `npm run test:budget -- --shard=1/3`, `2/3` and `3/3` each stay within budget locally.
- The Tests workflow log shows no `shard-sequencer:` warning.

## Limits

- The table is measured on a developer machine. CI runners can be slower on some files and not others, so the
  split is not exact on CI (see #605). Do not raise a limit or change the budget to hide that.
