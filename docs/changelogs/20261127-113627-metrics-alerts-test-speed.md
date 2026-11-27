# Faster metric alert tests

- The unit test for the metric alerts runs about 2 seconds faster, with the same limits and checks.

Area: Speed
Link: https://github.com/Shaked/x-thread-draft-tool/pull/PENDING

## Technical details

`runAlerts` takes `limits` (default `LIMITS`). `tests/api/metrics-alerts.test.js` pins `LIMITS.capacityOpsRows` at 100000 and tests the ops_events boundary with a limit of 100 rows instead of inserting 100 000 rows. Issue #599.
