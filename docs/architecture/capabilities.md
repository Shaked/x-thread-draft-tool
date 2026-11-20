# Capabilities: API, MCP and UI

Every user capability, the REST routes it uses (API), the MCP tools or prompts that expose it (MCP) and the React pages that show it (UI). A cell says `no: <reason>` when a surface is missing on purpose.

`tests/api/surface-alignment.test.js` reads the two tables below. It fails when a route, tool, prompt or page is missing from them, or when a cell names something that does not exist. Update this file in the same PR as any change to a route, tool, prompt or page.

Cell format: comma separated. API items are route keys as in `server/router.js` (`GET /drafts/:id`). MCP items are tool names, prompts as `prompt:<name>`. UI items are React Router paths; `/x/*` covers nested paths.

## Capabilities

| Capability | API | MCP | UI | Notes |
|---|---|---|---|---|
| List drafts | `GET /drafts` | `list_drafts` | `/` | Home page |
| Create draft | `POST /drafts` | `create_draft` | `/` | |
| Read draft | `GET /drafts/:id` | `get_draft` | `/draft/:id` | Editor page |
| Draft outline | `GET /drafts/:id/outline` | `get_draft_outline` | `/draft/:id` | |
| Edit draft settings | `PATCH /drafts/:id` | `update_draft` | `/draft/:id` | |
| Edit one post | `PATCH /drafts/:id/posts/:postId` | `update_post` | `/draft/:id` | |
| Add, move or remove a post | `GET /drafts/:id`, `PATCH /drafts/:id` | `add_post`, `move_post`, `remove_post` | `/draft/:id` | The tools read the draft, then write it back |
| Add image from URL | `POST /images`, `POST /images/from-url` | `add_image_from_url` | `/draft/:id` | `POST /images` takes raw bytes, so no tool calls it |
| Remove image | `DELETE /images` | `remove_image` | `/draft/:id` | |
| Duplicate draft | `POST /drafts/:id/duplicate` | `duplicate_draft` | `/draft/:id` | |
| Export draft | `GET /drafts/:id/export` | `export_draft` | `/draft/:id` | |
| Publish draft | `POST /drafts/:id/publish` | `publish_draft` | `/draft/:id` | |
| Delete draft | `DELETE /drafts/:id` | `delete_draft` | `/draft/:id` | |
| Split text into posts | `POST /threads/split` | `split_text`, `create_thread_from_text` | `/draft/:id` | `create_thread_from_text` also calls `POST /drafts` |
| Share link | `POST /drafts/:id/share-tokens`, `DELETE /drafts/:id/share-tokens`, `DELETE /drafts/:id/share-tokens/:token`, `GET /share/:token` | `create_share_link`, `revoke_share_link` | `/draft/:id`, `/x-thread-preview/:token` | The share page reads the public link |
| Signed-in user | `GET /auth/me` | `whoami` | `no: the app reads the user once at start, no page of its own` | |
| Version and changelog | `GET /version`, `GET /changelog` | `app_version` | `/about`, `/changelog` | |
| API tokens | `GET /tokens`, `POST /tokens`, `DELETE /tokens/:id` | `no: S-5: a person creates and revokes credentials on the Settings page` | `/settings/tokens` | |
| Connected apps | `GET /grants`, `DELETE /grants/:id` | `no: S-5: a person disconnects apps on the Settings page` | `/settings/tokens` | Same page as tokens until #281 splits them |
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

Routes that are not user capabilities. Each has a reason. The keys follow the same format as the API column; `/x/*` covers the path and everything below it.

| Route | Reason |
|---|---|
| `/auth/*` | Sign-in and session (the connection signs in with GitHub on its own) |
| `/auth/device/*` | Device sign-in steps, part of sign-in, not a user function |
| `/oauth/*` | OAuth protocol endpoints |
| `/.well-known/*` | OAuth metadata documents |
| `GET /openapi.json` | Documentation, not a user function |
| `GET /health` | Health check, not a user function |
| `GET /mcp/ui-manifest` | Deploy check: view hashes for the production smoke step, not a user function |
| `POST /mcp` | The MCP endpoint itself |
