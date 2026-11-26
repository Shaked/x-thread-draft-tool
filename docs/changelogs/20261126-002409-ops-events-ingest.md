# The ops events ingest route

- The scheduled metrics workflow can send its batch of CI events to the server.
- The server checks that workflow's own GitHub token and stores each new event once.
- Nothing shows the events yet, so the app looks the same.

Area: Admin
Link: https://github.com/Shaked/x-thread-draft-tool/issues/448

## Technical details

Central metrics plan M2 (#439, task #448): `server/routes/ops.js`, `server/ops/ingest.js`, `verifyOpsToken` in `server/oidc-ci.js`, Infrastructure row in `docs/architecture/capabilities.md`.
Tests: `tests/api/ops-ingest.test.js`.
