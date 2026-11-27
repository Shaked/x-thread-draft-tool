# Connect an AI app with MCP

Hebrew version: [mcp.he.md](./mcp.he.md). It has the connection steps, disconnect and troubleshooting in Hebrew.

X Thread Draft Tool has an MCP connector at `https://x-thread-draft-tool.vercel.app/api/mcp`.
An AI app that supports MCP can read and change your drafts through it. You approve the
connection once, on the sign-in page, and you can disconnect it at any time. Drafts are private:
only you can read them, and others see one only through a share link you make.

The approval page greets you by your GitHub login and has a read-only link with a Copy link button.
AI apps often open it in an in-app browser; copy the link and open it in your own browser instead
(opening it in another browser is supported). A signed-out visitor sees a "Sign in to continue" page
with the same link field before GitHub. If the page shows the wrong account, "Not you? Sign out" ends this
browser's session on the server and brings back the sign-in page; it does not disconnect AI apps or API tokens
(the Connected apps page, `/settings/apps`, does that).

The connector only sees what you can see in the app. It runs as you, with the same drafts and the
same limits as the web app.

## What the connector can do

| Group | Tools | Notes |
|---|---|---|
| Read | `list_drafts`, `get_draft`, `get_draft_outline`, `export_draft`, `split_text`, `whoami`, `app_version` | `list_drafts` returns summaries (no post text) unless you set `detail` to `full`. `get_draft_outline` counts posts and characters per post with a 40-character preview. Use `get_draft` only when you need the text. `export_draft` takes `numbered` for numbered text. `app_version` returns the live commit, deploy time and schema (also public at `GET /api/version`). |
| Write drafts | `create_draft`, `update_draft`, `duplicate_draft`, `create_thread_from_text`, `create_share_link` | `create_thread_from_text` turns long text into a draft. The four draft writes return the outline, not the text. `create_share_link` makes a one-time link that expires after 1 hour; set `one_time` false for a link that can be read many times, and `expires_in` (60 to 604800 seconds) for its lifetime. |
| Posts | `add_post`, `update_post`, `move_post`, `remove_post` | Post ids come from `get_draft`. A published draft cannot be changed. Each returns the draft outline and its `version`, not the text. |
| Images | `add_image_from_url`, `remove_image`, `move_post`, `get_draft_outline` | Only http(s) images that are public and 4 MB or smaller; at most 4 per post. `add_image_from_url` adds one (`postId`, optional `position`) or swaps one in place (`replace`). A picture that exists only in the chat has no URL: call it with `upload_link: true` and `postId` (no `url`) for a one-time link (30 minutes, up to the free slots of that post, 10 links per hour); give the link to the user, and when they say it is done call `get_draft_outline`. The link is a secret: show it as text only. `remove_image` removes one (`url`) or all of a post (`post_id`). `move_post` with `image_url` reorders an image or moves it to another post. `get_draft_outline` lists each post's image urls in order. `remove_image`, `move_post` and a `replace` take `version`. All return the outline, not the text. A published draft is refused. |
| Destructive | `publish_draft`, `delete_draft`, `remove_post`, `remove_image`, `revoke_share_link` | Marked as destructive, so most apps ask you before running them. `revoke_share_link` stops one share link (give `token`) or all of a draft's links. Share links are stored on the server with an expiry time, so each also stops by itself. |

Each tool result says what it changed and links to the draft. Writes answer with the draft outline (counts,
previews and `version`) and the editor `url`, not the full text, so the answer stays short; `get_draft` is the
only tool that returns the text. Draft text, titles and image URLs are data written by you. The connector
does not run instructions found in them.

When you ask an app to write a thread or posts, the server asks the app to save them as a draft and give you the draft link.

Limit: 120 tool calls per user per minute. A call over the limit returns an error that says
"Rate limit reached ... Wait one minute."

## Hebrew, and X/Twitter wording

X and Twitter mean the same service, and the connector says so in every tool description and in the
server instructions. The connector also tells apps to save a thread or posts you ask for as a draft by default; see
[Make your AI app save threads as drafts](#make-your-ai-app-save-threads-as-drafts) for a paste-in text. A post is also called a tweet (ציוץ, פוסט), a thread a שרשור and a draft a טיוטה.
Tool names stay in English; each description adds Hebrew trigger words, so a request in Hebrew finds
the same tools. The app answers in the language you write in and keeps Hebrew text exactly as typed
(niqqud and direction marks included). Post length uses the X rules, 280 per post, as in the app: a URL counts 23, an emoji counts 2, Hebrew and Latin letters count 1.

| Hebrew request | Tool |
|---|---|
| להפוך את הטקסט הארוך הזה לשרשור בטוויטר | `create_thread_from_text` |
| להציג את הטיוטות שלי | `list_drafts` |
| לספור את הציוצים והתווים בשרשור | `get_draft_outline` |
| לקצר את הציוץ השלישי | `update_post` |
| להזיז את הציוץ האחרון להתחלה | `move_post` |
| לייצא את השרשור כטקסט עם מספור | `export_draft` |
| ליצור קישור שיתוף לטיוטה | `create_share_link` |

`publish_draft` only marks the draft as published in this app (and deletes its images). It posts
nothing to X/Twitter. A request such as "לפרסם בטוויטר" does not post anything.

## Slash commands (prompts)

The connector offers four prompts. They are fixed text written by the server: building one reads no
draft and calls no model. What you type into an argument is placed after the instructions, inside a
fence, so it is treated as your text and not as instructions. Each prompt answers in the language you
write in (Hebrew in, Hebrew out) and keeps Hebrew exactly as typed.

| Prompt | Arguments | Does | Hebrew trigger |
|---|---|---|---|
| `thread_from_notes` | `notes` (required), `goal` | Rewrites notes as a thread and saves it with `create_draft` | לכתוב שרשור מהערות, להפוך רשימות לשרשור |
| `tighten_draft` | `draft`, `max_chars` (20 to 280) | Shows shorter text as before and after, then `update_post` once you agree | לקצר טיוטה, לקצר ציוצים |
| `review_before_publish` | `draft` | Lists problems with fixes. It does not publish or delete. | לבדוק שרשור לפני פרסום |
| `rewrite_hook` | `draft`, `goal` | Offers three first posts, then `update_post` on the one you pick | לכתוב פתיח חדש, הוק לציוץ הראשון |

`draft` is a draft id or its link in this app (`<app>/draft/<id>`). Without it, the model calls
`list_drafts` and asks which draft. Prompts need the same access token as tools and do not count
toward the 120 tool calls per minute.

How to run them: Claude Code shows them as `/mcp__x-thread__<name>` (per its documentation; the
part after `mcp__` is the name you gave the server). Other apps: not checked.

## Skill

The connector also serves one skill, `x-thread-drafts`, using the MCP skills extension
(`io.modelcontextprotocol/skills`, SEP-2640). It is one file, a short guide to the draft tools in
English and Hebrew: the workflow from notes to draft to review to share, the limits of a post, the
"Hebrew and RTL" rules, and the four prompts by name. It is fixed text written by the server and
carries no scripts.

- URI: `skill://x-thread-drafts/SKILL.md`. Read it with `resources/read` like any resource;
  `skills/list` and `skills/get` return its metadata, with a SHA-256 digest and the size in bytes.
- It needs the same access token as the tools and does not count toward the 120 tool calls per minute.
- No client is known to load MCP skills yet (checked 2026-11-14). Until one does, the file is only a
  plain resource: an app that can read resources may show it, and nothing is installed or run for you.

## What is not exposed, and why

- **Creating and revoking access tokens, and disconnecting apps** (rule S-5). Only you do this, on the
  Settings page. An app cannot grant itself more access.
- **Raw image upload** (rule D-5). Image bytes do not pass through the AI app. Use
  `add_image_from_url` with a public image URL.
- **Other resources, completions and sampling.** Only tools, the four prompts above, the one skill file and the views in [Views in Claude and ChatGPT](#views-in-claude-and-chatgpt).
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

**Grok**
1. Open `grok.com/connectors` and choose New Connector.
2. Choose Custom, paste the URL, and complete any sign-in the page asks for.

Not checked: these steps were not read from xAI's documentation. The page https://docs.x.ai/grok/connectors
could not be opened from the build environment on 2026-11-26, so the steps come from search results only.
Check them in the Grok app before you rely on them; the manual test is item 5 of
[#430](https://github.com/Shaked/x-thread-draft-tool/issues/430).

## Make your AI app save threads as drafts

The server tells AI apps to save a thread or posts you ask for as a draft, even when you do not
mention drafts. Some apps still only show the text. If yours does, paste one of these texts into
the app's own instructions. Each one is a plain sentence, and it publishes nothing.

English:

> When I ask you to write, draft or rewrite a thread or posts for X/Twitter, save it as a draft with
> the x-thread-draft-tool connector (create_thread_from_text) and give me the draft link. You can
> also show the posts as text. Do not mark a draft as published unless I ask.

Hebrew:

> כשאני מבקש לכתוב, לנסח או לשכתב שרשור או ציוצים ל-X/טוויטר, שמור אותם כטיוטה דרך המחבר
> x-thread-draft-tool (create_thread_from_text) ותן לי את הקישור לטיוטה. אפשר להציג גם את הציוצים
> כטקסט. אל תסמן טיוטה כפורסמה בלי שאבקש.

Where to paste it (the steps were read on 2026-11-17 and not checked against each app's current docs):

- ChatGPT: Settings, Personalization, Custom instructions; or the instructions of a project.
- Claude: Settings, Profile, the personal preferences field; or the instructions of a project.
- Claude Code: `CLAUDE.md` in the project, or `~/.claude/CLAUDE.md`.
- Codex: `AGENTS.md` in the project, or `~/.codex/AGENTS.md`.
- Grok: its custom instructions setting (not checked).

## Working on a draft

The server gives the assistant one contract for a draft (plan `docs/plans/draft-contract.md`, section 2.3). It reaches the assistant through the server instructions, the prompts, the skill and the tool results. Whether a given app reads each of those is not checked (see `tests/eval/discovery/clients.json`).

- R1. Edit at once: when asked to change a draft, change it with the tools first, without asking, then say what changed.
- R2. Change only what was asked: one `update_post` per changed post; the other posts stay as they are.
- R3. Short answer: one or two lines with the draft link; do not repeat text a view shows.
- R4. Options and post text as numbered block quotes, never a block of code (R8 is the one exception), never a table.
- R5. Hebrew stays as the user wrote it: no monospace, no code, no direction characters.
- R6. One option per item (3 when the user did not say how many), then one question at the end. Show a length only when a tool gave it.
- R7. A pick ("the second", "השנייה"): call `update_post` with that text and the draft version, then say so in one line.
- R8. After a save, one copy block of the whole saved thread is fine; options and single posts are not in a block.
- R9. Images: read the counts first, one change per call, and report the post's image count after each change.

Every draft result ends with a state line (id, version, post count, images, editor link, next step), so the assistant can act on the draft without fetching it again.

## Views in Claude and ChatGPT

Some tools can show their result as a small view inside an app that supports MCP Apps:

- `get_draft`, `create_draft`, `create_thread_from_text` and `split_text` show the thread view: X-style
  post cards, a character counter, your images and an "Open in editor" link.
- The edit tools (`update_draft`, `add_post`, `update_post`, `remove_post`, `move_post`, `remove_image`,
  `add_image_from_url`) show the thread view too, drawn from the draft as saved by that edit, never from an
  earlier read. They show only what changed. The view has each changed post now with its text before the edit,
  each removed post, the new version and a "Show all posts" button. The text quotes each changed post as it is now,
  so a result stays short. A repeat of the same edit writes nothing and says so in one line. The whole draft is shown instead when
  it has fewer than 4 posts, when most of its posts changed, when another write landed since the edit read the
  draft, or when two posts share an id. `_meta["x-thread/changes"]` carries the changes; `src/utils/draftChanges.js` computes them, so the editor
  and the History panel can show the same "what changed". A refused edit (the draft changed since it was read)
  shows its error text and no view data.
- `get_draft` with `view: "compact"` shows the heading and a "Show all posts" button only: for a read made only
  to change the draft. Its text and data are the same as a full read.
- `list_drafts` shows the drafts list: one row per draft, with "View thread" and, when the link is ours,
  "Open in editor". "View thread" asks the app to call `get_draft` again.
- `create_share_link` shows the share card: the preview and markdown links, Copy (when the app allows
  it) and the time left until the link expires.
- Every label and button in the three views is in English and in Hebrew (#371). The view uses the host's
  locale when the app sends one (`he` gives Hebrew, any other locale English), else the main script of the draft
  text, else English. In Hebrew the page is right to left; post text keeps its own direction. Which apps send a
  locale: not checked.

Each of these tools also returns the same text and data as before, so a client without views gets the
same answer it always got.

The thread tools (`get_draft`, `create_draft`, `create_thread_from_text`, `split_text`) add a second text
part after the JSON: the thread as markdown (title, editor link, each post quoted under its `n/N` line,
then a fenced block of all the post text to copy). It is the fallback, in this order: the view, then this
markdown, then the link in it. The thread view reads its posts from this part when an app passes the text
parts only or drops `_meta`, and it reports its size even when the app never answers `ui/initialize`
(#352: Grok showed an empty grey box). How Grok loads views is not checked; the browser test uses a fake
host that does what we could not rule out (`tests/e2e/mcp-grok-view.spec.ts`).

Every successful result of a tool that reads or changes one draft (`get_draft`, `get_draft_outline`, `create_draft`,
`create_thread_from_text`, `update_draft`, `duplicate_draft`, `add_post`, `update_post`, `remove_post`, `move_post`,
`add_image_from_url`, `remove_image`) ends with one state line (#390): `Draft <id>, version <v>, <n> posts, <k> over 280,
<m> images. Editor: <link>.` and one fixed next-step sentence. It holds no title, post text or image url, and errors
(including a stale-version 412) and `export_draft` have none. `get_draft` also has `post_count`.

- The app may ask you once before it shows a view. Nothing is shown without that answer.
- A view reads only the data in the tool result. It makes no network request of its own, and it loads
  images only from our image host (the Blob store). Its only call to the server is "View thread" in the
  drafts list, which asks the app to call `get_draft`.
- Showing the share card does not use up a one-time link. Opening the preview in the app does.
- Not checked: how Claude and ChatGPT draw the views. A robot cannot sign in there. The browser tests
  use test hosts (a hand-written one and the official AppBridge), not those apps.

## Disconnect

On the Connected apps page (`/settings/apps`), remove the app. The app loses access right away.
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
