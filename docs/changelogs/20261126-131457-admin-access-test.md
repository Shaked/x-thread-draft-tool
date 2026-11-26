# One test guards the whole admin area

- A new test checks that only the admin can reach admin pages, routes and assistant tools.
- Everyone else gets the same answer as for an unknown address.

Area: Admin
Link: https://github.com/Shaked/x-thread-draft-tool/pull/534

## Technical details

`tests/api/admin-access.test.js` and `tests/unit/admin-access-pages.test.jsx` build the list from code and fail when a new admin route, tool or page has no row (#485).
