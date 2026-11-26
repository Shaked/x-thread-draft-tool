# Old metrics rows are cleaned up every day

- Each day the metrics job totals yesterday's numbers and moves older hourly counts into daily totals.
- Old event records are deleted after 14 days, and old counts after 400 days.
- Only old metric rows are removed; no user data changes.

Area: Admin
Link: https://github.com/Shaked/x-thread-draft-tool/pull/480

## Technical details

Central metrics plan O5 (#336): `server/metrics/daily.js` (new), `server/routes/ops.js` (`POST /ops/metrics-daily`, `opsPathOpen`), `server/router.js` (the `/ops` gate), `server/oidc-ci.js` (`verifyOpsToken` audience parameter, `opsDailyAudience`), `.github/workflows/metrics-daily.yml` (job `daily`), `docs/operations/metrics-daily.md`, `docs/architecture/capabilities.md`.
Tests: `tests/api/metrics-daily.test.js` (new), `tests/api/ops-ingest.test.js` (two refusals expect 404 now), `tests/unit/metrics-daily-workflow.test.js`.
