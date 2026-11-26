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
- To end admin for one app, go to the Connected apps list on `/settings/apps` and revoke the app. A revoked connection stops working.
- `ADMIN_DISABLED=1` in the environment turns admin off for everyone, including you. It is read on every check, so a new deploy is needed for a change to apply.
- Any app you approve while signed in as you can use admin tools, with no time limit. Approve only apps you started yourself, and revoke apps you no longer use.
- The consent page names the app's own site (the host of its client_id), and says in bold when the return address is not on that site or on this computer (localhost or 127.0.0.1). Do not approve then. A registered app names no site, so the page says that instead.

The browser app shows who is admin from `GET /api/auth/me`: `user.role` is `admin` or `user` for a browser session (#282, `roleOf` in `role.js`). The badge and the Admin menu section show only for `admin`. An API token caller gets no `role`, and `ADMIN_DISABLED=1` gives `user`.

The changelog (`GET /api/changelog`, the `/changelog` page and the `changelog` key of `app_version`) is admin only: `requireAdminUser` in `server/admin/guard.js` calls `roleOf` in `role.js`; everyone else gets the 404 of an unknown path (#368).

## The ten tools

The admin connection sees the ten admin tools below. Nobody else sees any of them.

| Tool | Arguments | REST route |
|---|---|---|
| `admin_status` | none | `GET /api/admin/status` |
| `admin_list_users` | `limit` (1 to 100, default 50), `cursor`, `q` (login prefix), `status` (`all`, `active`, `suspended`) | `GET /api/admin/users` |
| `admin_get_user` | `id` (user UUID from `admin_list_users`) | `GET /api/admin/users/:id` |
| `admin_stats` | none | `GET /api/admin/stats` |
| `admin_audit_log` | `limit` (1 to 100, default 50), `before` (ISO time) | `GET /api/admin/audit` |
| `admin_metrics` | `window` (`1h`, `24h`, `7d`, `30d`, `90d`, `400d`; default `24h`), `by` (`route`, `op`, `caller`, `all`; default `route`), `route` (a route of the app or `unmatched`) | `GET /api/admin/metrics` |
| `admin_metrics_series` | `name` (`requests`, `errors_5xx`, `errors_4xx`, `rate_limited`, `cold_starts`, `p50`, `p95`, `p99`, or one `metrics_product_daily` column), `window` (`24h`, `7d`, `30d`, `90d`, `400d`; default `7d`), `route` (request series only) | `GET /api/admin/metrics/series` |
| `admin_list_flags` | none | `GET /api/admin/flags` |
| `admin_set_flag` | `flag` (`look` or `components`), `value` (`default` or `rare`); own view only, audited, no confirm token | `POST /api/admin/flags` |
| `admin_suspend_user` | `id`, `confirm_login` (the exact login, typed by you), `reason` (optional, 200 characters) | `POST /api/admin/users/:id/suspend` |
| `admin_unsuspend_user` | `id`, `confirm_login` | `POST /api/admin/users/:id/unsuspend` |
| `admin_delete_user` | `id`, `dry_run` (default true), `confirm_token`, `confirm_login` | `POST /api/admin/users/:id/delete` |

The REST routes are under `/api/admin/`. They answer 404 to everyone except the admin connection (MCP) and the owner's browser session (web, below), the same answer as an unknown path. The smoke test checks this on the deployed site (`PASS admin paths answer like an unknown path (404)`).

The answers hold account details and numbers only. They never hold draft text, token secrets, token hashes, client secrets or image URLs.

Limits, from `server/admin/limits.js`: suspend and unsuspend together, 30 actions per hour. Delete, 5 per hour. Each admin call counts once in the normal MCP rate row (120 calls per minute).

## The web surface (the owner's browser session, #283)

The `/api/admin/*` routes also answer the owner's browser session. All of these must hold, checked in this order, with no database query until the last:

1. The call is not an in-process MCP call.
2. The request has no `Authorization` header (so `xt_` tokens, OAuth `/api` tokens and the CI identity never pass).
3. The request has the header `x-xt-admin: 1`. A custom header forces a CORS preflight, which this API never allows, so a page on another site cannot send it. Cross-origin writes also get 403 from the router's Origin check.
4. The session cookie verifies (HS256, no audience, has a `jti`).
5. `roleOf` in `role.js` says admin for the GitHub id in the session. `ADMIN_DISABLED=1` turns this off too.
6. Then the one statement that checks revoked, suspended and exists.

The check is `realSession` in `server/session.js`, used only by `server/admin/guard.js`. It ignores view-as. Each web call adds 1 to the per-minute MCP count (120 a minute); past that the answer is 429. The router gate (`adminPathOpen`) is async and never counts. The per-tool route binding applies to MCP only. Web admin changes (any method but GET) need a browser sign-in from the last 12 hours (`WEB_WRITE_MAX_AGE_SECONDS` in `server/admin/guard.js`; a refusal is 403 "Sign in again: ..."). Reads are not limited. This is owner decision O6, and 12 hours is its default. MCP has no such rule.

A delete confirm token is bound to its surface and its binding: the MCP grant on MCP, the browser session's `jti` on web (`bindOf` in `server/admin/confirm.js`). A token opens only on the surface that made it, and only in the session that made it. Another session's token, or a token from the other surface, answers 400 "confirm_token is not valid for this call. Run the dry run again."

The browser pages are under `/admin` (#285): `src/pages/admin/` is one lazy chunk that is never precached (`tests/unit/admin-bundle.test.js` checks it). `isAdmin` in `src/utils/currentUser.js` is the one place the browser reads the role; the server still decides.

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
- Every row has `details.surface`: `mcp` or `web`. The `details` field never holds a secret.
- Read it with `admin_audit_log`, newest first.

## Scale note

The stats query (`GET /api/admin/stats`) is one statement of scalar subqueries, and the tables are small today. When `users` passes about 10 000 rows, add an index on `mcp_rate_limits(minute)` and on `users(created_at)` before the stats get slow.

## If something goes wrong

- A user was suspended by mistake: run `admin_unsuspend_user` with the same login. Nothing was deleted.
- A delete stopped in the middle: the user is still suspended. Run a fresh dry run, then the real delete with the new token. Each step is safe to repeat.
- `ADMIN_DISABLED=1` turns admin tools off. Set it in the environment and make a new deploy, so the server reads it.

## Request counts (metrics rollup, plan O2)

Each request adds one row to `metrics_hourly` in the database, after the answer is sent: the hour, the route
template (never a real path, id or token), the operation (an MCP method or `tool:<name>` for a known tool), the
caller (`web`, `token`, `ci` or `anon`; MCP calls by app family: `mcp:claude`, `mcp:chatgpt`, `mcp:grok`, `mcp:cli` or `mcp:other`) and status counts. Latency is kept as a fixed 65-counter histogram.

- A request that used no SQL (health, version, changelog, openapi) is held in memory and written with the next
  request on the same instance that does use the database. Pending counts are lost when the instance stops.
- `METRICS_DISABLED=1` turns the write off. A failed write logs `[metrics] write failed` and never changes the answer.
- Nothing reads these rows yet. The reading routes and the admin page come in later tasks of
  `docs/plans/observability.md`.
