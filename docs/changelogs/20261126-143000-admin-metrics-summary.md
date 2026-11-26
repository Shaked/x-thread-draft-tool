# An agent can read the metrics in plain lines

- The admin can ask for a metrics summary: speed, CI checks, deploys, production requests and the database, each with its limit and last week's value.
- The admin can list delivery events (failed runs, merges, deploys), newest first, with a link to each.

Area: Admin
Link: https://github.com/Shaked/x-thread-draft-tool/issues/451

## Technical details

Central metrics M5 (#451), decision D3: `GET /api/admin/metrics/summary` and `/events`, tools `admin_metrics_summary` and `admin_metrics_events` (admin tools 12 to 14). New `server/metrics/summary.js`; `groupRows` takes an optional `to`; `dbSizeBytes` is exported from `server/metrics/daily.js`.
