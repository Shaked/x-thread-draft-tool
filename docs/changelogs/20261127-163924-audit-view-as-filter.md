# The audit log filter shows view-as actions

- The action filter on the admin audit log now lists starting and ending a view as a user.

Area: Admin
Link: https://github.com/Shaked/x-thread-draft-tool/pull/607

## Technical details

`src/pages/admin/AdminAuditPage.jsx` adds `view_as_start` and `view_as_end` to the filter (written by `server/routes/admin.js`, #290). Test: `tests/unit/AdminAuditPage.test.jsx`. Net lines in `src/` are unchanged.

Screenshot: img/20261127-163924-audit-view-as-filter.png
