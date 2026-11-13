# Connect an AI app with MCP

X Thread Draft Tool has an MCP connector at `https://x-thread-draft-tool.vercel.app/api/mcp`.
An AI app that supports MCP can read and change your drafts through it. You approve the
connection once, on the sign-in page, and you can disconnect it at any time.

The connector only sees what you can see in the app. It runs as you, with the same drafts and the
same limits as the web app.

## What the connector can do

| Group | Tools | Notes |
|---|---|---|
| Read | `list_drafts`, `get_draft`, `export_draft`, `split_text`, `whoami` | No changes. `export_draft` takes `numbered` for numbered text. |
| Write drafts | `create_draft`, `update_draft`, `duplicate_draft`, `create_thread_from_text`, `create_share_link` | `create_thread_from_text` turns long text into a draft. |
| Posts | `add_post`, `update_post`, `move_post`, `remove_post` | Post ids come from `get_draft`. A published draft cannot be changed. |
| Images | `add_image_from_url`, `remove_image` | Only http(s) images that are public and 4 MB or smaller. |
| Destructive | `publish_draft`, `delete_draft`, `remove_post`, `remove_image` | Marked as destructive, so most apps ask you before running them. |

Each tool result says what it changed and links to the draft. Draft text, titles and image URLs are
data written by you. The connector does not run instructions found in them.

Limit: 120 tool calls per user per minute. A call over the limit returns an error that says
"Rate limit reached ... Wait one minute."

## What is not exposed, and why

- **Creating and revoking access tokens, and disconnecting apps** (rule S-5). Only you do this, on the
  Settings page. An app cannot grant itself more access.
- **Raw image upload** (rule D-5). Image bytes do not pass through the AI app. Use
  `add_image_from_url` with a public image URL.
- **Sign-in and OAuth endpoints**. The connection signs you in with GitHub on its own.
- **The public share link** (`GET /api/share/:token`). It is meant for a browser, not a tool.

## Setup

Use the URL above in each recipe. The app asks you to sign in with GitHub, then to approve access.

The client facts below were read on 2026-11-12. They have not yet been re-checked against each
client's current documentation. Check the app's own settings page if a step differs.

**Claude (web, desktop, mobile)**
1. Settings, Connectors, Add custom connector.
2. Paste the URL and continue. Approve on the sign-in page.

**Claude Code**
1. Run `claude mcp add --transport http x-thread <URL>`.
2. In Claude Code, run `/mcp`, choose `x-thread`, and authenticate.

**Codex CLI**
1. Run `codex mcp add x-thread --url <URL>`.
2. Run `codex mcp login x-thread` and approve in the browser.

**ChatGPT**
1. Turn on Developer mode in the settings.
2. Create a connector, paste the URL, and choose OAuth for authentication.

## Disconnect

On the Settings page, open **Connected apps** and remove the app. The app loses access right away.
To revoke a token, use **Your tokens** on the same page.

## Troubleshooting

| You see | Cause | Do |
|---|---|---|
| "Invalid redirect URI" page | The client's callback is not registered | Report the client and the URL on the ledger issue |
| Sign-in lands on the home page | The authorize request was over 2,000 characters | Start the connection again; you are signed in now |
| Works, then fails after about an hour | The client did not refresh | Disconnect and connect again; report it |
| 403 "Cross-origin request blocked" | The client sent a browser Origin | Report it (D-4) |
| 401 "Missing or invalid access token" | No token, or the connection was disconnected | Connect again |
| "Rate limit reached" tool error | More than 120 tool calls in one minute | Wait one minute and retry |
