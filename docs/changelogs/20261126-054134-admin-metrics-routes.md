# Admin metrics routes and tools (O4, #335)

- New admin-only `GET /api/admin/metrics` and `GET /api/admin/metrics/series`, and the MCP tools `admin_metrics` and `admin_metrics_series` (admin tool list: 8 to 10). Answers come from `server/metrics/view.js`, cached for 60 s.
- Other callers get the 404 of an unknown path, as for every admin route. No UI yet (`docs/architecture/capabilities.md`: planned in #331 Task 6).
