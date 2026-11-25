# Request counts are kept in the database

- The app now records how many requests each route gets, per hour.
- Nothing shows the counts yet, so the app looks the same.

Area: Admin
Link: https://github.com/Shaked/x-thread-draft-tool/pull/460

## Technical details

Observability plan task O2 (#333): `server/metrics/record.js` writes one row to `metrics_hourly` after each answer,
with pending rows for requests that used no SQL. Callers are set in `server/session.js` and `server/mcp/server.js`.
Tests: `tests/api/metrics-record.test.js` (14 tests). Operations notes: `docs/operations/admin.md`.
