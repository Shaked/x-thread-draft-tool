# Faster checks on every pull request

- The unit tests now run in three parallel parts, so no part goes over its time limit.
- A test run that is too slow now names the slowest files in its error message.

Area: Speed
Link: https://github.com/Shaked/x-thread-draft-tool/pull/491

## Technical details

Issue #490: `.github/workflows/tests.yml` matrix `[1, 2, 3]`, `scripts/test-budget.mjs` names the 3 slowest files when the total is over, limits unchanged.
