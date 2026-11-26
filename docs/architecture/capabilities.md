# Capabilities: API, MCP and UI

Every user capability, the REST routes it uses (API), the MCP tools or prompts that expose it (MCP) and the React pages that show it (UI). A cell says `no: <reason>` when a surface is missing on purpose.

`tests/api/surface-alignment.test.js` reads the two tables below. It fails when a route, tool, prompt or page is missing from them, or when a cell names something that does not exist. UI cells are checked for page existence only: a UI cell says which page exists, not that the page offers the capability. Parity is verified by reading the page. Notes name every known gap where the UI does not call the route the rule asks for.

How draft saves, conflicts (412) and live updates (304) work, in short: [draft-sync.md](draft-sync.md).

Cell format: comma separated. API items are route keys as in `server/router.js` (`GET /drafts/:id`). MCP items are tool names, prompts as `prompt:<name>`. UI items are React Router paths; `/x/*` covers nested paths.

## Capabilities

| Capability | API | MCP | UI | Notes |
|---|---|---|---|---|
| List drafts | `GET /drafts` | `list_drafts` | `/` | Home page |
| Create draft | `POST /drafts` | `create_draft` | `/` | |
| Read draft | `GET /drafts/:id` | `get_draft` | `/draft/:id` | Editor page |
| Did the draft change? (conditional read) | `GET /drafts/:id` | `no: get_draft is called once per answer, not polled` | `/draft/:id` | REST: `If-None-Match` of the current version gives 304 (#360). The editor sends it every 4 s while visible (#363); no AI app sends it |
| Draft outline | `GET /drafts/:id/outline` | `get_draft_outline` | `no: no page shows the outline, the UI never calls this route` | Rule gap: no UI |
| Edit draft settings | `PATCH /drafts/:id` | `update_draft` | `/draft/:id` | The editor sends `If-Match` with the version it read; a stale save is 412 (#361) |
| Edit one post | `PATCH /drafts/:id/posts/:postId` | `update_post` | `/draft/:id` | Rule gap: the editor saves the whole draft with `PATCH /drafts/:id`, not this route |
| What an edit changed | `no: a REST write answers the saved draft; a client compares two saved drafts with src/utils/draftChanges.js` | `update_draft`, `add_post`, `update_post`, `remove_post`, `move_post`, `remove_image`, `add_image_from_url` | `no: the editor shows the draft as you type it; the History panel (#366) is to show it with the same function` | The edit tools' card and text show the changed posts, before and after (#405). One function, `changesOf` in `src/utils/draftChanges.js`, so UI and API can show the same shape |
| Add, move or remove a post | `GET /drafts/:id`, `PATCH /drafts/:id` | `add_post`, `move_post`, `remove_post` | `/draft/:id` | The tools read the draft, then write it back |
| Add image from URL | `POST /images`, `POST /images/from-url` | `add_image_from_url` | `/draft/:id` | `POST /images` takes raw bytes, so no tool calls it |
| List images of a draft | `GET /drafts/:id/outline` | `get_draft_outline` | `/draft/:id` | The outline gives each post its image urls in order and its count (at most 4); write results give the counts only (#367) |
| Move or replace an image | `GET /drafts/:id`, `PATCH /drafts/:id`, `POST /images/from-url`, `DELETE /images` | `move_post`, `add_image_from_url` | `no: the editor has no image reorder or replace today (#367 part b)` | `move_post` with `image_url`; `add_image_from_url` with `replace` or `position`. Rule gap: the tools build the move and the replace from `GET` + `PATCH /drafts/:id`; no REST route of their own (follow-up task) |
| Remove image | `GET /drafts/:id`, `PATCH /drafts/:id`, `DELETE /images` | `remove_image`, `remove_post` | `/draft/:id` | `remove_image` with `post_id` removes every image of that post. Rule gap: the editor drops the image from the post and saves with `PATCH /drafts/:id`; it never calls `DELETE /images`. `remove_post` calls it |
| Duplicate draft | `POST /drafts/:id/duplicate` | `duplicate_draft` | `/` | Rule gap: the home list copies the draft in the browser and calls `POST /drafts`, not this route |
| Export draft | `GET /drafts/:id/export` | `export_draft` | `/draft/:id` | Rule gap: the UI formats the export in the browser (`ExportOptions.jsx`) and never calls this route |
| Publish draft | `POST /drafts/:id/publish` | `publish_draft` | `/draft/:id` | |
| Delete draft | `DELETE /drafts/:id` | `delete_draft` | `/` | Delete button on the home list |
| Split text into posts | `POST /threads/split` | `split_text`, `create_thread_from_text` | `no: the UI never calls this route, the editor splits text in the browser` | Rule gap: `create_thread_from_text` also calls `POST /drafts` |
| Share link | `POST /drafts/:id/share-tokens`, `DELETE /drafts/:id/share-tokens`, `DELETE /drafts/:id/share-tokens/:token`, `GET /share/:token` | `create_share_link`, `revoke_share_link` | `/draft/:id`, `/x-thread-preview/:token` | Rule gap: the UI creates links only; no UI revokes them. The share page reads `GET /share/:token` |
| Signed-in user | `GET /auth/me` | `whoami` | `no: the app reads the user once at start, no page of its own` | |
| Version and changelog | `GET /version`, `GET /changelog` | `app_version` | `/about`, `/changelog` | Changelog is admin only (#368): `GET /changelog` and `/changelog` answer 404 to everyone else, and `app_version` adds the `changelog` key only for the admin |
| API tokens | `GET /tokens`, `POST /tokens`, `DELETE /tokens/:id` | `no: S-5: a person creates and revokes credentials on the Settings page` | `/settings/tokens` | Own page since #281 |
| Feature flags (look) | `no: a browser-only preference, stored on the device like the theme` | `no: a browser-only preference with nothing for an assistant to read or change` | `/settings/flags` | The Rare UI look and the real Rare UI components (#406); two switches in localStorage: `xt-skin` (set as `data-skin` on `<html>`) and `xt-kit` (read by the `src/ui` wrapper `ThemePicker`) |
| Connected apps | `GET /grants`, `DELETE /grants/:id` | `no: S-5: a person disconnects apps on the Settings page` | `/settings/apps` | Own page since #281 |
| MCP prompts | `no: a prompt is a message template, it has no REST route` | `prompt:thread_from_notes`, `prompt:tighten_draft`, `prompt:review_before_publish`, `prompt:rewrite_hook` | `no: the AI app shows prompts, no page of ours` | Slash commands in the AI app |
| Admin status | `GET /admin/status` | `admin_status` | `no: the admin badge (Task 8) shows the same fact` | Admin only |
| Admin list users | `GET /admin/users` | `admin_list_users` | `no: planned in #273 Tasks 11 to 14` | Admin only |
| Admin user details | `GET /admin/users/:id` | `admin_get_user` | `no: planned in #273 Tasks 11 to 14` | Admin only |
| Admin statistics | `GET /admin/stats` | `admin_stats` | `no: planned in #273 Tasks 11 to 14` | Admin only |
| Admin audit log | `GET /admin/audit` | `admin_audit_log` | `no: planned in #273 Tasks 11 to 14` | Admin only |
| Admin suspend user | `POST /admin/users/:id/suspend` | `admin_suspend_user` | `no: planned in #273 Tasks 11 to 14` | Admin only |
| Admin unsuspend user | `POST /admin/users/:id/unsuspend` | `admin_unsuspend_user` | `no: planned in #273 Tasks 11 to 14` | Admin only |
| Admin delete user | `POST /admin/users/:id/delete` | `admin_delete_user` | `no: planned in #273 Tasks 11 to 14` | Admin only |

## Infrastructure

Routes that are not user capabilities. Each has a reason. The keys follow the same format as the API column; `/x/*` covers the path and everything below it. A wildcard also covers any future route under that prefix, so a new user capability there needs its own row in the table above.

| Route | Reason |
|---|---|
| `/auth/*` | Sign-in and session (the connection signs in with GitHub on its own), including the device sign-in steps |
| `/oauth/*` | OAuth protocol endpoints |
| `/.well-known/*` | OAuth metadata documents |
| `GET /openapi.json` | Documentation, not a user function |
| `GET /health` | Health check, not a user function |
| `POST /ops/events` | Metrics ingest from the `metrics-daily` workflow (its own OIDC token, #448), not a user function |
| `GET /mcp/ui-manifest` | Deploy check: view hashes for the production smoke step, not a user function |
| `POST /mcp` | The MCP endpoint itself |
