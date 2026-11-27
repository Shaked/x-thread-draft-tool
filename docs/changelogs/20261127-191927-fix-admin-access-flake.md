# Admin page tests no longer fail at random

- No change for people using the app.

Area: Docs
Link: https://github.com/Shaked/x-thread-draft-tool/pull/620
Screenshot: not needed, no visible change

## Technical details

Fixes #619 (Implements #273 Task 5 (flake)). In `tests/unit/admin-access-pages.test.jsx`, `visit()` waited with `findByText(/./)`, which the loading skeleton's text satisfied at once. With a slow session check it read the path before the redirect ran. It now waits for the skeleton and the lazy fallback to go, then flushes effects with `act`. No app code changed.
