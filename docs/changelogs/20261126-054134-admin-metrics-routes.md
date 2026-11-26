# The admin can read request metrics per route

- The admin can see requests, errors and response times for each route, for the last hour up to 400 days.
- The admin can see how requests, errors and cold starts change over time, per hour or per day.

Area: Admin
Link: https://github.com/Shaked/x-thread-draft-tool/pull/481

## Technical details

Central metrics plan O4 (#335), decision D3: `GET /api/admin/metrics` and `GET /api/admin/metrics/series` (admin only), tools `admin_metrics` and `admin_metrics_series`. Files: `server/metrics/view.js` (new), `server/metrics/queries.js` (new), `server/routes/admin.js`, `server/mcp/admin-tools.js`, `docs/architecture/capabilities.md`, `docs/operations/admin.md`.
Tests: `tests/api/admin-metrics.test.js` (new), `tests/api/admin-mcp.test.js` and `tests/api/admin-elevation.test.js` (admin tool count 8 to 10).
