# Room for CI, deploy and error events in the database

- The database has tables ready for events from CI runs, merges, deploys and production errors.
- Nothing shows them yet, so the app looks the same.

Area: Admin
Link: https://github.com/Shaked/x-thread-draft-tool/pull/465

## Technical details

Central metrics plan task M1 (#439, task #447): migration `db/migrations/011_ops_events.sql`, `server/ops/events.js`, `server/ops/sources.js`.
Tests: `tests/unit/ops-events.test.js`, `tests/api/ops-schema.test.js`.
