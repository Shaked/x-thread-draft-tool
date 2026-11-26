# Admin changes: 7-day sign-in window and a sign-in pop-up (#552)
- A web admin change needs a sign-in from the last 7 days (was 12 hours). MCP is not affected.
- An older sign-in opens a sign-in pop-up; after signing in, the change (flag, suspend, unsuspend, delete) is saved once by itself.
- The server refusal now carries the code `sign_in_again`. A toast says "Flag saved." on the flags page.
