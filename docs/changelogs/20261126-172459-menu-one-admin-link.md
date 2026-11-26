# The menu has one Admin link

- For the admin, the app menu now has one "Admin" link. The changelog moved out of Settings: open it from the admin menu.

Area: Admin
Link: https://github.com/Shaked/x-thread-draft-tool/pull/556

## Technical details

`src/components/AppMenu.jsx`: the Settings "Changelog" button and the "Admin" section with "Admin area" become one "Admin" link (#551).
Tests: `tests/unit/AppMenu.test.jsx` and `tests/e2e/app-menu.spec.ts` (exactly one admin link for the admin, none for a normal user).
