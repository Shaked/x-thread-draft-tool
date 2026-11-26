# Every admin page is now tested with real data

- Each change now opens every admin page as the admin, on a phone and a computer, and checks that real data shows.

Area: Admin
Link: https://github.com/Shaked/x-thread-draft-tool/pulls

## Technical details

`tests/e2e/admin-area.spec.ts` (#551): the admin's real browser session against the local API, no fixed answers. For each admin
menu entry at 390 px and 1280 px: the menu marks it, its heading and one piece of real content show, no error, no "Coming soon",
no sideways scroll. Each page's error message with Try again when its data fails. A normal user never reaches `/admin`.
The "after" screenshots of #551 are in `docs/screenshots/admin-bug/after/`.
