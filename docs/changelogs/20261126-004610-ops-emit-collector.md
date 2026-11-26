# The metrics collector reads CI, merges, deploys and speed stages

- Every 6 hours a scheduled workflow reads the last 3 days of CI runs, merges, deployments and speed stages from GitHub and sends them to the ops events route.
- A run that is re-run within those 3 days is stored too. A re-run started later is not collected.
- The workflow only reads; it writes nothing to GitHub and nothing shows the events yet.

Area: Admin
Link: https://github.com/Shaked/x-thread-draft-tool/issues/449

## Technical details

Central metrics plan M3 (#439, task #449): `scripts/ops-emit.mjs` (imports `scripts/speed-metrics.mjs` and `server/ops/sources.js`), `.github/workflows/metrics-daily.yml`, `docs/operations/metrics-daily.md`.
Tests: `tests/unit/ops-emit.test.js` (offline fixtures in `tests/unit/fixtures/ops/api.json`), `tests/unit/metrics-daily-workflow.test.js`.
