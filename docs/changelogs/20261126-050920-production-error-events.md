# Production errors are recorded as events

- A 5xx answer in production adds one error event, with its route, status, error class, code and region. No message or id is stored.

Area: Admin
Link: https://github.com/Shaked/x-thread-draft-tool/issues/450

## Technical details

Central metrics plan task M4 (#450, decision D2): `server/metrics/record.js` adds one `prod/error` row to `ops_events` (built by `normalizeEvent`), at most 20 per instance per hour and 200 per UTC day. `server/perf.js` `noteError` keeps the class name and code from `server/router.js`. Tests: `tests/api/metrics-errors.test.js`.
