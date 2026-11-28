# Viewing as a user shows counts only

- While an admin views as a user, the draft list shows each draft as "Private draft" with its counts.
- A draft, its export and its history cannot be opened, and the editor page says drafts are private.

Area: Security
Link: https://github.com/Shaked/x-thread-draft-tool/pull/0

## Technical details

`server/view-as-redact.js` (`redactForViewAs`) is the one place that decides it; every GET route under `/drafts` calls it. The outline answers counts with no preview and no image urls. `tests/api/view-as-private.test.js` and the leak scan cover it. Implements #273 Task H11.

Screenshot: img/20261128-023921-view-as-counts-only.png
