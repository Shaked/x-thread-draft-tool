# Admin changes need a sign-in from the last 7 days, and ask for it in a pop-up

- A change in the admin area of the web app needs a sign-in from the last 7 days. It was 12 hours.
- When your sign-in is older, a pop-up asks you to sign in with GitHub, and your change is then saved by itself. This covers feature flags, suspend, unsuspend and delete.
- AI apps are not affected.

Area: Admin
Link: https://github.com/Shaked/x-thread-draft-tool/pull/554

## Technical details

`server/admin/guard.js`, `server/routes/auth.js`, `src/components/admin/SignInAgain.jsx`, `src/utils/api.js`. The refusal carries the code `sign_in_again`. Implements #552 Task 3.
