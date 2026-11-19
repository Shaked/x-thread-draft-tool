# Admin consent box and pairing code (A4, #188)

- The consent page shows a tick box only to the owner, and only for a real Claude or ChatGPT return address on the MCP resource with a sign-in under 10 minutes old. A tick gives a one-time pairing code on a new page; the code is not sent anywhere else. Nothing is admin yet: admin_activate (A5) comes next.
- Tests: tests/api/admin-elevation.test.js (new); tests/api/admin-identity.test.js pins the return-address list. The screenshot job also captures the box and the pairing page.
