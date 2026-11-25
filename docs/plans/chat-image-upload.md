# Plan: get an image that exists only in the chat into a draft (#367 part c)

Owner: #367 (task I1 of epic #273). Planner: Opus, 2026-11-25. Status: plan; build tasks C1 to C6 below,
none started. How assistants use the image tools in every client is the contract's section 3.1
(`docs/plans/draft-contract.md`); this plan picks the routes that section 3.1 point 5 names.

## 1. The problem, with evidence

- A user attaches a picture in an AI chat and asks to put it in a post. The assistant says it cannot.
- Cause (checked, #367 findings comment): `add_image_from_url` takes only an `http(s)` URL. The model
  sees the picture but holds no URL and no bytes. A `data:` URL gets "Only http and https URLs are
  allowed"; a file path gets "Invalid URL". Nothing tells the assistant what to do instead.
- A model cannot type out the bytes of a picture it was shown. So "base64 in the tool call" works only
  when a program sends the bytes: our own view, a script, or an agent with file access. It is not a
  route for the chat model itself.

## 2. Limits that every route must respect

| Limit | Value | Source |
|---|---|---|
| Images per post | 4 | editor, REST schema, MCP (checked) |
| Image size | 4 MB on the server; the editor takes 5 MB and resizes to 1600 px width first | `server/routes/images.js`, `src/components/ImageUpload.jsx` (checked) |
| MCP request body | 1,000,000 bytes, so about 700 KB of image as base64 | `server/mcp/server.js` (checked) |
| Vercel request body | 4.5 MB | code comment in `server/routes/images.js`; not re-checked (docs host blocked here) |
| Tool calls | 120 per user per minute | `server/mcp/rate.js` (checked) |
| Blob storage and transfer on Hobby | not checked | see owner question Q2 |
| What each client can pass to a tool for a chat file | not checked for any client | section 6 steps |

## 3. Routes considered

| Route | How it works | Works in | User steps | Verdict |
|---|---|---|---|---|
| A. Editor | The assistant gives the editor link and says which post; the user drags, pastes or picks the file there; the assistant reads `get_draft_outline` and moves or places it | every client that shows a link (all of them) | 2: open link, drop file | **Ship first (C1).** Works today, needs only text |
| B. One-time upload link | A tool option returns a link to a small page for one post; the user opens it (phone or desktop), picks or pastes up to the free slots; the page uploads; the assistant reads the outline | every client | 2: open link, pick file | **Build (C2).** The general route; no sign-in prompt in the chat |
| C. Upload in our view | The thread view gets an "Add image" control; the view resizes the file and asks the host to call the tool with the bytes (rule 10: the view sends nothing itself) | only hosts that render our views and allow a file input in the view frame (Claude.ai renders views: `clients.json`; file input not checked) | 1 | **Build after C2 (C3)**, behind a check that the host allows it |
| D. Bytes in the tool call from the model | The model pastes base64 | none (a model cannot produce the bytes) | 0 | **Rejected** for chat models. The same input (C4) serves C and agents with file access (Claude Code) |
| E. Client file reference | The client passes its own file id or a download link | not checked for any client | 0 | **Wait for facts** (section 6). If a client passes a public download link, `add_image_from_url` already takes it, once redirects are followed (C5) |

## 4. Design

### 4.1 C1: say the one way that works (text only, every client)
- `add_image_from_url` checks its `url` before the upload. When it is not an `http(s)` URL (a `data:`
  URL, a file path, an attachment name), it answers with a fixed error that names route A, with the
  editor link and the post number: "That is not a public image URL. An image attached in the chat
  cannot be sent to this tool. Ask the user to open <editor link> and add it to post <n> (drag, paste or
  click), then call get_draft_outline to see it." When C2 ships, the text names the upload link first.
- The same sentence goes into the tool's `url` parameter description (not the tool description: that
  text feeds the discovery score; see 4.6).
- English only in the error, like every server error today; the assistant answers in the user's
  language (server instructions). Hebrew trigger words stay in `TRIGGERS`.

### 4.2 C2: one-time upload link
- **Ask:** `add_image_from_url` with `upload_link: true` and `postId` (no `url`) creates a link. No new
  tool (a new tool moves every discovery floor, #409). A REST route `POST /drafts/:id/posts/:postId/upload-links`
  is the one server function; the tool calls it in-process; the editor does not need it.
- **Token:** 32 random bytes, only its hash stored (`image_upload_links`: id, user_id, draft_id,
  post_id, token_hash, slots, expires_at, used_at). Bound to one user, one draft, one post. Expires
  after 30 minutes. Takes at most the free slots of that post at creation (1 to 4). Single use for the
  page: once the slots are filled or it expires, it is dead.
- **Page:** `/upload/<token>`, a small React page with the editor's file picker, paste and drop, and
  the editor's resize (1600 px width, which also drops EXIF). It works without signing in (owner
  question Q1; the token is the credential). It shows only "Add up to <n> images to post <i>" and the
  thumbnails it uploaded, not the draft title or text, so a leaked link shows nothing the user wrote.
- **Upload:** `POST /api/upload-links/<token>/images` with raw bytes, the same checks as
  `POST /images` plus C6's checks. The server attaches each image to the post with the #370 retry
  loop and the draft version, so a concurrent edit is never overwritten (#354).
- **Rate:** at most 10 links per user per hour, 4 uploads per link. Expired rows are deleted by the
  existing cleanup job.
- **Result to the assistant:** the link, the post, the free slots and the expiry, plus the line
  "Give this link to the user. When they say it is done, call get_draft_outline." The link is a
  secret for 30 minutes: the result says so, and the view never shows it (rule 9).

### 4.3 C3: upload in our view
- The thread view gets an "Add image" button per post when the host supports file inputs. The view
  reads the file, resizes it on a canvas to at most 1600 px width and 700 KB (JPEG or WebP), and asks
  the host to call `add_image_from_url` with `data` (C4). Rule 10 holds: only `callTool`, no request of
  its own; rule 9 holds: no user data in attributes.
- Hosts where the file input or the bridge call fails fall back to the C2 link (the view asks the host
  to call the tool with `upload_link: true` and shows the link as text).

### 4.4 C4: bytes as input (for C3 and agents)
- `add_image_from_url` takes `data` (base64) and `mime` instead of `url`. At most 700 KB decoded,
  so the MCP body limit holds. Same checks as C6. Documented for agents with file access (Claude Code)
  in `docs/agents/mcp.md`; REST agents keep `POST /images`.

### 4.5 C5 and C6: safer and friendlier fetch and upload
- **C5, redirects:** follow up to 3 redirects, each hop checked by the same public-address rule and
  pinned connection (`server/remote-image.js`). Client download links (route E) usually redirect.
- **C6, safety, on every upload route (`POST /images`, `from-url`, C2, C4):** decide the type from the
  first bytes (PNG, JPEG, WebP, GIF only) and ignore the `Content-Type` header for that, so file hosts
  that answer `application/octet-stream` work and a wrong type is refused; refuse SVG (scripts);
  remove EXIF and text chunks from JPEG, PNG and WebP in plain JS (GPS in photos); a per-user storage
  cap (owner question Q2), counted from the Blob listing the admin tools already use; admin delete
  already removes the user's Blob folder first (files-first rule, `server/blob.js`).

### 4.6 Text and evals (part d)
- Section 3.1 lines go into the `url`, `upload_link` and `data` parameter descriptions and the error
  texts. The tool descriptions change only if `tests/api/mcp-discovery.test.js` keeps every floor.
- New discovery phrases (EN and HE) for "add this picture I attached" map to `add_image_from_url`.
- A format check: every image error text names a next step (no bare "cannot").
- Fixture-host e2e for C3: a fake host that allows file inputs and one that does not (fallback to C2).

## 5. Per client (what to tell the assistant to do)

| Client | Chat-only image route now (after C1) | After C2 | After C3 | Facts |
|---|---|---|---|---|
| Claude (claude.ai) | editor link (A) | upload link (B) | in-view upload if the file input works | views render (`clients.json`); file input not checked |
| Claude Desktop | A | B | not checked | not checked |
| ChatGPT | A | B | not checked | not checked; file reference (E) not checked |
| Grok | A | B | no views known | not checked |
| Claude Code | `data` (C4) or REST `POST /images` with the API token | same | n/a | reads local files (checked: it is an agent with file tools) |
| generic | A | B | n/a | not checked |

## 6. Steps for Shaked (client facts this container cannot check)

1. In Claude (claude.ai), ChatGPT and Grok, open a chat with the connector, attach a small photo and
   type: "Add this picture to post 1 of my latest draft." Look at the tool call the app shows: is
   `url` empty, a `data:` text, a file name, or a link? Paste what you see on #367.
2. After C1 ships, repeat step 1. Look: the assistant now gives the editor link and says which post.
3. After C2 ships, repeat step 1 on your phone. Look: the assistant gives an upload link; open it,
   pick the photo, then say "done". The assistant should report "Post 1 has 1 of 4 images".
4. After C3 ships, in Claude.ai: open a draft card and press "Add image" on a post. Look: does a file
   picker open, and does the image appear in the post?

## 7. Build tasks

| Task | What | Executor | Validator | Complexity | Depends on | PR line |
|---|---|---|---|---|---|---|
| C1 | Non-URL input gets the editor-route error; `url` parameter text | Haiku 5.5 | Sonnet | S | none | `Implements #273 Task I1 C1` |
| C6 | Type from bytes, no SVG, EXIF removed, storage cap | Sonnet | Opus (security, deletion) | M | Q2 for the cap value (ship without the cap if unanswered) | `Implements #273 Task I1 C6` |
| C5 | Follow up to 3 checked redirects | Haiku 5.5 (Sonnet fallback) | Opus (SSRF) | S | none | `Implements #273 Task I1 C5` |
| C2 | One-time upload link: table, REST routes, page, tool option, cleanup | Sonnet | Opus (auth, SQL) | L | C6; Q1 | `Implements #273 Task I1 C2` |
| C4 | `data` input on `add_image_from_url` | Haiku 5.5 (Sonnet fallback) | Opus (security) | S | C6 | `Implements #273 Task I1 C4` |
| C3 | Upload in the thread view, fallback to C2 | Sonnet | Opus (design) | M | C2, C4 | `Implements #273 Task I1 C3` |

Each PR also carries `Implements #<its task issue> Task 1` (the net-lines check needs a numeric task)
and a changelog file. Text for every task follows section 3.1 of the contract and keeps the discovery
floors.

## 8. Owner questions

- Q1: may the upload link work without signing in (the token is the key, 30 minutes, one post)?
  Recommendation: yes. Default if nobody answers: yes.
- Q2: a storage cap per user (money: Blob storage and transfer). Recommendation: 200 MB per user.
  Default if nobody answers: no cap in C6; the admin statistics show each user's usage first.

Both are posted on epic #273 in the owner-question format.
