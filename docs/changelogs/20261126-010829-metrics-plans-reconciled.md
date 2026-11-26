# One plan for metrics, without double work

- The two metrics plans now name one table set per kind of number and one admin page.
- The admin metrics tools for AI apps will all start with the same name.
- Nothing in the app changes yet.

Area: Admin
Link: https://github.com/Shaked/x-thread-draft-tool/issues/458

## Technical details

Decision record in `docs/plans/central-metrics.md` section 9 (D1 to D7, #458). M5 routes and tools renamed to
`/api/admin/metrics/summary`, `/api/admin/metrics/events`, `admin_metrics_summary`, `admin_metrics_events`.
Retention of `ops_*` moves to O5. New fold task #475 (one Telegram alert shape).
