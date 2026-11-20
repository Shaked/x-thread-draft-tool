# Admin tools (owner only)

Who this is for: the owner, and agents that work for the owner. This page is not served by the app and is not linked from `public/llms.txt`, `docs/agents/*` or the skill text. Plan and history: issue #117 (epic), #171 to #205 (tasks A1 to A10).

## Who is admin, and where that is set

- Admin is one GitHub numeric id: `960015` (github.com/Shaked). It is in `server/admin/identity.js` as `ADMIN_GITHUB_IDS`. A login is never used, because a login can be renamed. `tests/api/admin-identity.test.js` pins the list.
- Who is admin is decided only in `server/admin/role.js`. `tests/api/admin-role-arch.test.js` fails if any other module decides it.
- No environment variable adds an admin. `ADMIN_DISABLED=1` only turns admin off. The value is read on every check. Set it in the Vercel environment and make a new deploy so the change is live (how Vercel applies env changes: not checked here).
- The admin account and the CI identity (`ci-smoke`) can never be suspended or deleted. This is enforced in code and in SQL, and does not depend on `ADMIN_DISABLED`.
- Any AI app you connect while signed in as the owner can hold admin tools. No list of app addresses is kept, and no code or time limit is used.

## How to get admin tools

Admin follows your GitHub identity and nothing else. There is no code, no box, no time limit and no extra approval.

1. Sign in to X Thread Draft Tool with GitHub as `Shaked` (github id 960015).
2. In your AI app (Claude, ChatGPT, Grok or a command-line app), connect X Thread Draft Tool through its MCP connector as usual and approve it. The approval page shows "You are the admin" and the address of the app. This line only informs you: admin comes from your identity, not from this page. Check that the address is your own app.
3. The admin tools appear in that connection's tool list. To check, ask the app to run `admin_status`.

Rules that come from the code:

- Any MCP connection (OAuth token for the MCP address) of GitHub id 960015 gets the admin tools. Other users never get them, and the REST API and device tokens never do.
- The AI app keeps its own saved copy of the tool list. After you first connect, refresh the connector's tool list in the app, or delete and re-add the connector, so it asks the server again. If the list is still missing admin tools after that, read the production runtime log: each `tools/list` writes `[mcp] tools/list admin_list=true`, or `admin_list=false reason=<via|resource|flag|disabled|gh>` (the first condition that failed). No `tools/list` line after a connect means the app is still using its saved list and never asked.
- To end admin for one app, go to the Connected apps list on the settings page and revoke the app. A revoked connection stops working.
- `ADMIN_DISABLED=1` in the environment turns admin off for everyone, including you. It is read on every check, so a new deploy is needed for a change to apply.
- Any app you approve while signed in as you can use admin tools, with no time limit. Approve only apps you started yourself, and revoke apps you no longer use.
- The consent page names the app's own site (the host of its client_id), and says in bold when the return address is not on that site or on this computer (localhost or 127.0.0.1). Do not approve then. A registered app names no site, so the page says that instead.

## The eight tools

The admin connection sees the eight admin tools below. Nobody else sees any of them.

| Tool | Arguments | REST route |
|---|---|---|
| `admin_status` | none | `GET /api/admin/status` |
| `admin_list_users` | `limit` (1 to 100, default 50), `cursor`, `q` (login prefix), `status` (`all`, `active`, `suspended`) | `GET /api/admin/users` |
| `admin_get_user` | `id` (user UUID from `admin_list_users`) | `GET /api/admin/users/:id` |
| `admin_stats` | none | `GET /api/admin/stats` |
| `admin_audit_log` | `limit` (1 to 100, default 50), `before` (ISO time) | `GET /api/admin/audit` |
| `admin_suspend_user` | `id`, `confirm_login` (the exact login, typed by you), `reason` (optional, 200 characters) | `POST /api/admin/users/:id/suspend` |
| `admin_unsuspend_user` | `id`, `confirm_login` | `POST /api/admin/users/:id/unsuspend` |
| `admin_delete_user` | `id`, `dry_run` (default true), `confirm_token`, `confirm_login` | `POST /api/admin/users/:id/delete` |

The REST routes are under `/api/admin/`. They answer 404 to everyone except the elevated admin connection, the same answer as an unknown path. The smoke test checks this on the deployed site (`PASS admin paths answer like an unknown path (404)`).

The answers hold account details and numbers only. They never hold draft text, token secrets, token hashes, client secrets or image URLs.

Limits, from `server/admin/limits.js`: suspend and unsuspend together, 30 actions per hour. Delete, 5 per hour. Each admin call counts once in the normal MCP rate row (120 calls per minute).

## What a suspended user sees

- Every sign-in is refused. On the login page the user sees "This account is suspended." (`server/suspension.js`, `src/components/LoginPage.jsx`). The sign-in callback sends them to `/?suspended=1`, and they get no session cookie.
- Their tokens, connected apps and MCP calls stop working. MCP answers 403.
- Their share links answer 410.
- Their data is not deleted by suspension. `admin_unsuspend_user` restores them.

## How to delete a user (irreversible)

1. Suspend the user with `admin_suspend_user`. Type their exact login as `confirm_login`.
2. Wait 10 minutes. A delete before that answers 409 and shows the time when it is allowed.
3. Dry run: call `admin_delete_user` with `dry_run` true (the default). It shows the login and the counts, and gives a `confirm_token`. The token lasts 10 minutes and works only for this user and these counts.
4. Real run: call `admin_delete_user` with `dry_run` false, the `confirm_token`, and the login typed again as `confirm_login`.

What the server does, in order:

- It locks the user row and checks again that the user is still suspended, before any file is touched.
- It removes the user's image files under `drafts/<user id>/` only. It removes nothing else.
- Only when the file list is empty, it deletes the user in one database transaction. Everything of the user goes with it (cascade), and a `done` audit row is written in the same transaction.
- If a step fails, the user stays suspended and a `failed` audit row is written. Finish the job with a fresh dry run: the old `confirm_token` no longer works once the content has changed (409 "The content changed. Run the dry run again.").
- While a delete runs (up to 15 minutes), `admin_unsuspend_user` answers 409.

## The audit log

- Table `admin_audit` (migration `009_admin.sql`). It has no foreign keys on purpose, so a row outlives the user it is about.
- Each row keeps the admin's id and login, the action, the outcome (`started`, `done`, `failed`, `refused`), and the target's id, GitHub id and login.
- The `details` field never holds a secret.
- Read it with `admin_audit_log`, newest first.

## Scale note

The stats query (`GET /api/admin/stats`) is one statement of scalar subqueries, and the tables are small today. When `users` passes about 10 000 rows, add an index on `mcp_rate_limits(minute)` and on `users(created_at)` before the stats get slow.

## If something goes wrong

- A user was suspended by mistake: run `admin_unsuspend_user` with the same login. Nothing was deleted.
- A delete stopped in the middle: the user is still suspended. Run a fresh dry run, then the real delete with the new token. Each step is safe to repeat.
- `ADMIN_DISABLED=1` turns admin tools off. Set it in the environment and make a new deploy, so the server reads it.
