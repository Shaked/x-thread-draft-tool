# The daily metrics step rolls up counters and deletes old metric rows

- Once a day the metrics workflow writes yesterday's product numbers, moves hourly counters older than 14 days into the daily table, and deletes old ops events (14 days) and counters (400 days).
- The step runs with its own sign-in token, and the `/ops` paths answer 404 to every other caller.
- It deletes metric rows only; no user data changes.

Area: Admin
Link: https://github.com/Shaked/x-thread-draft-tool/issues/336

## Technical details

Central metrics plan O5 (#336): `server/metrics/daily.js` (new), `server/routes/ops.js` (`POST /ops/metrics-daily`, `opsPathOpen`), `server/router.js` (the `/ops` gate), `server/oidc-ci.js` (`verifyOpsToken` audience parameter, `opsDailyAudience`), `.github/workflows/metrics-daily.yml` (job `daily`), `docs/operations/metrics-daily.md`, `docs/architecture/capabilities.md`.
Tests: `tests/api/metrics-daily.test.js` (new), `tests/api/ops-ingest.test.js` (two refusals expect 404 now), `tests/unit/metrics-daily-workflow.test.js`.
