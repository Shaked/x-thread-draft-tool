# MCP Apps: thread and drafts views inside Claude and ChatGPT

Epic: #127. State: STARTED.

Written 2026-11-14 UTC. Plan file: `docs/plans/mcp-apps.md`. Tracker: epic #127. For an executor that follows instructions literally.

Owner request (Shaked, 2026-11-14): "Render UI components in Claude and in ChatGPT for the tools and use cases we have so far, using MCP Resources / MCP Apps. For example render how the thread looks for a specific draft, or the list of drafts, including embedded tweets and images. Suggest more."

## 1. Who does what

| Role | Model | Job |
|---|---|---|
| Executor | Haiku, or Sonnet where the task says so | Does one task at a time, exactly as written in section 5. |
| Judge | Opus | Reviews every pull request against the task's "Done when" list before merge. Answers `APPROVE` or `CHANGES` with a numbered list. For Tasks 1, 3, 5 and 7 Opus also checks rule 9 (escaping) and rule 10 (CSP) line by line. |
| Adviser | Opus | Answers every doubt. The executor asks Opus, never guesses and never asks Shaked a design question. |
| Helper | Sonnet | Takes over a step when Haiku failed it twice, or when a step needs code in more than three files at once. |

Opus does not decide owner-only matters (money, secrets, deleting data, product behaviour not written here). Those go to the epic under "Needs from Shaked".

## 2. Rules

1. Read `AGENTS.md` first.
2. One task, one branch from the latest `main`, one pull request, one changelog file (`docs/changelogs/<UTC YYYYMMDD-HHMMSS>-<slug>.md`).
3. Procedures P-PR, P-CODEX, P-CI, P-MERGE, P-PROD are in [hardening-finish.md](./hardening-finish.md) section 5, with the same three exceptions as [private-drafts-share-links.md](./private-drafts-share-links.md) rule 3. The pull request body starts `Implements docs/plans/mcp-apps.md Task <n>` (the `Net lines` check needs it: Tasks 1 to 8 add product code under `server/`).
4. Before P-MERGE, Opus answers `APPROVE` for the head commit. Record the verdict as one line in the pull request description.
5. Each task ships on its own: merge, then P-PROD (production deployment READY, deployed smoke test green), then the next task.
6. After each merge, update the task row in the epic (PR number, `merged`, production checked).
7. A test that changes because behaviour changed on purpose is fine; name the test and the reason in the pull request. Never delete an assertion without a replacement.
8. Every check runs without a person: unit tests, `npm run test:api`, Playwright (`npm run test:e2e`), the smoke script. A real Claude or ChatGPT render cannot be checked by a robot (section 3, "Not checked"); it is never a merge condition.
9. Draft text, titles, image URLs and tweet URLs are data. In the views they reach the page only through `textContent`, `setAttribute` on a fixed list of attributes (`href`, `src`, `alt`, `dir`, `title`), and only after the URL check in Task 1 step 4. No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function` or `on*=` attributes in any view. A unit test greps the view source for these (Task 1 step 7).
10. Views load nothing from other hosts except draft images from the one Blob store host (section 4, D4). No `<script src>`, no `<link>`, no web fonts, no `fetch`/`XMLHttpRequest`/`WebSocket`. `connectDomains` is always empty.
11. Every tool keeps its text `content` and `structuredContent` exactly as today. A host without MCP Apps (Claude Code, Codex, Grok, older clients) sees no difference except the extra `_meta` keys.

## 3. State (checked 2026-11-14 on `main` at `016d65b`)

- `server/mcp/server.js` is a hand-written, stateless JSON-RPC server (no SDK at runtime). It speaks 2026-07-28 (`server/discover`) and the legacy `initialize` versions. `CAPABILITIES` already has `resources: {}` and the skills extension. `resources/list`, `resources/templates/list` and `resources/read` exist and serve one static resource, `skill://x-thread-drafts/SKILL.md` (`server/mcp/skills.js`). Unknown URI: `-32602` (modern) or `-32002` (legacy). Resource answers carry `ttlMs: 3600000`, `cacheScope: 'public'`.
- Every MCP request needs an OAuth `xta_` token bound to `<origin>/api/mcp` (`authorize` in server.js). Tools run as the caller with `runAs`; tools call the REST router in-process. A browser `Origin` that is not the app origin is refused with 403.
- `callTool` (`server/mcp/tools.js`) returns `{ content: [{type:'text', text: <JSON>}], isError, structuredContent: <same JSON> }`. There is no way for a tool to add result `_meta` today. `listTools()` returns `name, title, description, inputSchema, annotations`, no `_meta`.
- `list_drafts` returns summaries (`server/draft-stats.js` `summarize`: id, title, is_published, updated_at, published_at, version, post_count, total_chars, over_limit_count, image_count). No editor URL in summaries. `get_draft` returns `{ draft: {..., url} }`. `get_draft_outline` gives per-post `chars`, `remaining`, `over_limit`. Character count is `text.length` until private-drafts T6 switches it to the X rules in `draft-stats.js`.
- `server/share/render.js` renders the public share page as server HTML (dark only, X-style cards, `isRTL`, `htmlEscape`, `linkify`, images grid, embedded tweets through `platform.twitter.com/widgets.js`). The editor (`src/components/TweetEmbed.jsx`) also loads `widgets.js`.
- Draft images live on Vercel Blob: `https://<store>.public.blob.vercel-storage.com/drafts/<uid>/...` (`server/draft-images.js`). They are readable by URL (private-drafts D9).
- The deployed smoke test (`smoke-deployed.yml`, `scripts/smoke.mjs`) signs in with a GitHub OIDC token that the REST API accepts. MCP accepts only `xta_` tokens, and minting one needs a person on the consent page, so the deployed smoke test cannot call an authenticated MCP method (mcp-clients plan D-18).
- `tests/api/mcp-skills.test.js` asserts `resources/list` has exactly one entry. It changes on purpose in Task 1.
- `@modelcontextprotocol/sdk` 1.32.2 is a devDependency, used by `tests/api/mcp-sdk-client.test.js`.
- Not checked: the exact Blob store host name in production (read it in Task 1 step 3); how ChatGPT caches a `ui://` resource; whether ChatGPT requires `_meta.ui.domain` for a custom (unlisted) connector; whether our private-drafts T5 to T7 are merged when this plan starts.

### MCP Apps facts this plan relies on (researched 2026-11-14)

Verified from the spec file (`modelcontextprotocol/ext-apps`, `specification/2026-01-26/apps.mdx`, stable) and Claude's connector docs (claude.com/docs/connectors/building/mcp-apps: getting-started, quickstart, troubleshooting):

- Extension id `io.modelcontextprotocol/ui`. The host declares it in its client capabilities with `mimeTypes: ["text/html;profile=mcp-app"]`. The spec says servers should check this before linking tools; a stateless server cannot, so we always add the `_meta` (rule 11 keeps text fallback).
- A view is a resource with a `ui://` URI, `mimeType: "text/html;profile=mcp-app"`, content in `text`, one full HTML5 document.
- Tool link: `tools/list` entry `_meta.ui.resourceUri`. Optional `_meta.ui.visibility: ["model","app"]` (`["app"]` hides a tool from the model; the view can still call it). The flat key `_meta["ui/resourceUri"]` is deprecated but still written by the official helper.
- Resource `_meta.ui`: `csp { connectDomains, resourceDomains, frameDomains, baseUriDomains }`, `permissions { clipboardWrite, ... }`, `domain`, `prefersBorder`. Claude reads `_meta.ui` from the `resources/read` content item (it wins over the list entry). Without `csp`, the host default is: inline scripts and styles allowed, images only same-origin and `data:`, `connect-src 'none'`. `resourceDomains` feeds `img-src`, `script-src`, `style-src`, `font-src`, `media-src`, and allows wildcard subdomains.
- Bridge: JSON-RPC 2.0 over `postMessage` to `window.parent`. View sends `ui/initialize` (with `appCapabilities`, protocol version `2026-01-26`), gets `hostContext` (`theme` light/dark, `styles.variables`, `displayMode`, `containerDimensions`, `locale`), then sends `ui/notifications/initialized`. Host sends `ui/notifications/tool-input` (arguments) and `ui/notifications/tool-result` (a standard `CallToolResult` with `content`, `structuredContent`, `_meta`), `ui/notifications/host-context-changed`, `ui/resource-teardown`. View may send `tools/call`, `ui/open-link {url}`, `ui/message`, `ui/notifications/size-changed {width,height}`.
- Claude: shows the view after a per-server "Allow" prompt; an invisible view is usually a missing handshake or zero height; results over about 150,000 characters do not reach the view; iOS sends no `Referer`. `_meta.ui.domain` (`<sha256(server URL)[0:32]>.claudemcpcontent.com`) is needed only for a stable origin (own OAuth); we do not set it.
- The official package `@modelcontextprotocol/ext-apps` (1.7.x) gives `App` for views and `registerAppTool`/`registerAppResource` for the TypeScript SDK server. Using `App` in a view means bundling it (or loading it from a CDN, which rule 10 forbids). Our server does not use the SDK, so we hand-write a small bridge and test it against the package's host side (`@modelcontextprotocol/ext-apps/app-bridge`) as a devDependency only.

From OpenAI's docs as quoted by search results (developers.openai.com was not reachable from this session, so not read directly):

- ChatGPT implements MCP Apps: `_meta.ui.resourceUri` is the standard key, `_meta["openai/outputTemplate"]` the compatibility alias (both should hold the same URI); MIME `text/html;profile=mcp-app` replaces `text/html+skybridge`; CSP goes in `_meta.ui.csp`. `window.openai` (toolOutput, setWidgetState) remains as ChatGPT's older API. A forum report says ChatGPT on Android sometimes skips `resources/read` (text renders, view blank).

## 4. Decisions (agent; Shaked may reopen any)

| # | Decision | Why |
|---|---|---|
| D1 | Hand-written bridge (about 100 lines) inlined into each view. No `@modelcontextprotocol/ext-apps` at runtime; it is a devDependency for the compatibility test only. | One self-contained HTML string, no bundler, no third-party script, rule 10. |
| D2 | Views are JS modules under `server/mcp/ui/` that export one HTML string each, built at module load from shared parts (bridge, CSS, render functions). Client functions are real functions in `server/mcp/ui/client.js`, inlined with `Function.prototype.toString()`, so the same code is unit-tested in jsdom and shipped. No runtime file read (same rule as skills, D-17). | Testable, no build step, Vercel bundles it like any module. |
| D3 | Each view URI carries a content hash: `ui://x-thread/thread.html?v=<sha256 first 12 hex>`. `resources/read` accepts only the exact current URI. | Hosts cache templates; a new HTML gets a new URI, so a stale cached view is never paired with new data. |
| D4 | `resourceDomains` holds exactly one host, the production Blob store host (`https://<store>.public.blob.vercel-storage.com`), never the wildcard `*.public.blob.vercel-storage.com` (that would let any Vercel customer's file load as a script source). Images on any other host show as a link chip, not as an image. | Images work; script sources stay closed. |
| D5 | Embedded tweets show as a card with the tweet URL, the "@handle / status id" text and an "Open on X" button (`ui/open-link`). X's `widgets.js` is not loaded (the Q1 default applies unless Shaked changes it). | No third-party script, no `frameDomains`, X learns nothing from a view. |
| D6 | Views link to the existing tools Shaked named: thread view to `get_draft`, `split_text`, `create_thread_from_text`, `create_draft`; drafts list view to `list_drafts`. No new model-visible tool. | His words: "for the tools we have so far". If the cards are too noisy (a card on every `get_draft` while the model edits), Task 9 lists it for him; the fix is a new `show_thread` tool and unlinking `get_draft`. |
| D7 | Views are read-only, except opening links (`ui/open-link`) and, in the drafts list, opening one draft's thread view by calling `get_draft` through the host (`tools/call`, a read). Write buttons wait for Q2; the read-only default applies unless Shaked changes it. | Safe first; the host confirms each link. |
| D8 | `get_draft` results get `_meta["x-thread/outline"]` = `outline(draft)` from `server/draft-stats.js` (counts per post). `list_drafts` results get `_meta["x-thread/editorBase"]` = `<origin>/draft/`. `content` and `structuredContent` do not change. | One source of character counts (it follows private-drafts T6 automatically); no client-side copy of the X counting rules. |
| D9 | Theme: `hostContext.theme`, then `prefers-color-scheme`. Host `styles.variables` are used when present, with our own light and dark values as fallback. Text direction: `dir="auto"` on every title and post text, `unicode-bidi: plaintext`. | Hebrew, English and mixed text render in the right order in both themes. |
| D10 | Private-drafts D8 ("no drafts as MCP resources") stands: views are static templates with no user data; user data reaches a view only inside the tool result of the signed-in user. | Same privacy model as the tools. |
| D11 | Production check: the deployed smoke test cannot call MCP (state, last bullet). Default (applies unless Shaked changes Q3): a public, read-only `GET /api/mcp/ui-manifest` returns `[{uri, mimeType, sha256, size}]` for each view, no HTML, and the smoke step compares it with the hashes the checked-out commit computes. | Proves production serves this commit's views and URIs, without opening MCP to unsigned requests. |

## 5. Tasks

Order: Task 0, 1, 2, 3, 4, 5, 6, then 9. Task 7 is held (Q2: read-only first). Task 8 (real tweets, T8) comes after the card ships (Q1). Starts after #111 tasks T5 to T7 for the tasks that edit server/mcp/tools.js (Tasks 4 to 6); other tasks may start earlier.

### Task 0. Plan on `main` (Haiku, docs only)
Files: `docs/plans/mcp-apps.md` (this file), `docs/plans/index.md`, `docs/plans/current.md`, `AGENTS.md` ("Current plan" line, only when #111 is closed), changelog.
1. The epic #127 is open; keep its task table up to date.
2. Done when: merged; the epic row Task 0 says `merged`.

### Task 1. View plumbing, bridge and a minimal thread view (Sonnet; ships dark)
Files: new `server/mcp/ui/index.js`, `server/mcp/ui/client.js`, `server/mcp/ui/thread.js`; `server/mcp/server.js`; tests `tests/api/mcp-ui.test.js`, `tests/unit/mcp-ui-client.test.js`, `tests/e2e/mcp-ui.spec.ts`, `tests/e2e/fixtures/mcp-host.html`; `tests/api/mcp-skills.test.js` (resource count changes on purpose); `package.json` (devDependency `@modelcontextprotocol/ext-apps` pinned exact version).
1. `server/mcp/ui/index.js` exports `listUiResources()`, `readUiResource(uri)` (contents or null) and `uiResourceUri(name)`. Each view: `{ name, title, description, html }`. The list entry: `uri`, `name`, `title`, `description`, `mimeType: 'text/html;profile=mcp-app'`, `size`, `_meta.ui`. The read content item: `uri`, `mimeType`, `text`, `_meta.ui` with `csp: { connectDomains: [], resourceDomains: [BLOB_ORIGIN] }` and `prefersBorder: true`. URI per D3.
2. `server.js` `dispatchResources`: `resources/list` returns skill resources then UI resources; `resources/read` tries the skill, then the view. Same TTL and error codes as today. No change to auth, `CAPABILITIES` or the 401 path.
3. `BLOB_ORIGIN`: `https://<store>.public.blob.vercel-storage.com`. Ask Opus where the store id comes from (an env var, or the store id part of `BLOB_READ_WRITE_TOKEN`, which is `vercel_blob_rw_<storeId>_<secret>`). Never log or return the token. Local dev and tests: the dev server's image origin. If no store is known, `resourceDomains` is `[]`.
4. `client.js`, browser-only functions (no imports): `bridge()` (sends `ui/initialize` with protocol version `2026-01-26` and `appCapabilities: {}`, stores `hostContext`, sends `ui/notifications/initialized`, handles `tool-input`, `tool-result`, `host-context-changed`, `resource-teardown`, answers nothing it does not know, sends `size-changed` from a `ResizeObserver`, exposes `openLink(url)` and `callTool(name, args)` with a request id and a 15 s timeout); `safeUrl(url, allowedHosts)` (only `https:`; returns null otherwise); `el(tag, attrs, children)` that sets only rule-9 attributes and text. If `window.openai.toolOutput` exists and no tool result came within 1 s, render it (ChatGPT's older path). Ignore every message whose `source` is not `window.parent`.
5. `thread.js`: a full HTML document: `<meta charset>`, `<meta name="color-scheme" content="light dark">`, inline `<style>` and one inline `<script>` that inlines `client.js` functions and renders the title and each post's text as plain paragraphs (Task 3 makes it look like X). It reads `structuredContent.draft.posts` (get_draft, create_draft) or `structuredContent.posts` (split_text). Before any result: "Loading thread…". On `isError`: the error text.
6. No tool links yet: `tools/list` is unchanged. This task is safe to ship dark.
7. Tests:
   - API (`tests/api/mcp-ui.test.js`, starts with `// @vitest-environment node`): on 2026-07-28 and on 2025-06-18, `resources/list` has the skill and the view; entries and `resources/read` results validate against the vendored MCP schema (`tests/api/fixtures/mcp-schema`); MIME is exactly `text/html;profile=mcp-app`; a wrong `?v=` is "not found"; unsigned request still 401; the HTML has no `<script src`, no `<link`, no `http://`, no host except `BLOB_ORIGIN`; size under 32 KB; HTML is the same for two different users.
   - Unit (`tests/unit/mcp-ui-client.test.js`, jsdom): the view source contains none of the words in rule 9; `safeUrl` refuses `javascript:`, `data:`, `http:`, other hosts; a post with text `<img src=x onerror=alert(1)>` renders as that exact text.
   - Playwright (`tests/e2e/mcp-ui.spec.ts`): `mcp-host.html` puts the view in `<iframe sandbox="allow-scripts" srcdoc>` with the host CSP (`default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: <BLOB_ORIGIN>; connect-src 'none'`), answers `ui/initialize`, then sends a fixture tool result. Checks: handshake happens; text appears; a `size-changed` with height above 0 arrives; no network request leaves the page (`page.on('request')`). A second run uses `AppBridge` from `@modelcontextprotocol/ext-apps/app-bridge` as the host (bundle it for the test page with the `esbuild` that Vite already installs; if that fails twice, ask Opus, and keep the hand-written host).
8. Done when: all tests pass; `npm run test:budget` passes; Opus has checked rules 9 and 10; after merge, production READY and the deployed smoke test green (it does not see the view yet; Task 2 adds that).

### Task 2. Production check for the views (Haiku)
Files: `server/routes/` (new small route or an entry in an existing public route file; ask Opus which), `server/router.js` if routes are listed there, `tests/api/mcp-ui.test.js`, `tests/api/mcp-coverage.test.js` (the route is not a tool route: add it to the excluded list), `scripts/smoke.mjs`, `server/openapi.js`.
1. Follow Q3. Default D11: `GET /api/mcp/ui-manifest`, no sign-in, `cache-control: no-store`, returns `{ views: [{ uri, mimeType, sha256, size }] }` built from `listUiResources()` and `readUiResource()`. No HTML in the answer.
2. `scripts/smoke.mjs` new step "mcp ui manifest matches this commit": import `server/mcp/ui/index.js` from the checkout, compute the same list, compare with the deployed answer. The smoke job already checks out the merge commit.
3. Done when: API test for the route passes; `npm run smoke` passes locally; after merge the deployed smoke test on production prints the new step as PASS.

### Task 3. Thread view looks like X (Sonnet; still dark)
Files: `server/mcp/ui/thread.js`, `server/mcp/ui/client.js`, new `server/share/x-css.js` (the X card CSS taken out of `server/share/render.js`, with light and dark values as CSS variables), `server/share/render.js` (imports it; the share page keeps its dark look), tests from Task 1, `tests/unit/render.test.ts` (must stay green unchanged).
1. Each post as an X card: avatar circle with the title initial (no avatar URL is in the tool result, so none is fetched), "Draft" name, the post number `i/N`, text with `dir="auto"` and line breaks, links as buttons that call `openLink` (only `https:` links), the counter `chars/280` from `_meta["x-thread/outline"]` (red with "over by n" when `over_limit`; hidden when the outline is missing, for example on `split_text`), images grid 1 to 4 (D4: only `BLOB_ORIGIN` images load, `loading="lazy"`, `alt="Image n of m"`; others become link chips), embedded tweet card (D5).
2. Header: draft title (`dir="auto"`), post count, "Published" badge when `is_published`, "Open in editor" button (`openLink(draft.url)`, only when `draft.url` starts with the app origin given by the result). For `split_text`: a "Not saved yet" banner.
3. Theme per D9; follows `host-context-changed`. Width: fits 320 px, no horizontal scroll; long words wrap.
4. Long drafts: more than 25 posts show the first 25 and a "Show all n posts" button (keeps the first paint small).
5. Tests: Playwright fixtures: English draft with 3 images and an embedded tweet; Hebrew draft (check computed `direction` is `rtl` for Hebrew posts and `ltr` for an English post in it); mixed Hebrew and a URL; one post over 280; dark and light (`hostContext.theme`), screenshot both at 390 px into the screens project; an image on another host renders as a link, not an `<img>`. Unit: counter text; XSS fixtures in title, text, image URL and tweet URL.
6. Done when: tests pass; size under 48 KB; `render.test.ts` unchanged and green; the net lines of `render.js` go down; Opus checked rules 9 and 10.

### Task 4. Show the thread view from the tools (Haiku; goes live)
Files: `server/mcp/tools.js`, `tests/api/mcp-ui.test.js`, `tests/api/mcp-contract.test.js` and `tests/api/mcp-schema.test.js` (new `_meta` keys, on purpose), `docs/agents/mcp.md`, changelog.
1. `listTools()`: for `get_draft`, `create_draft`, `split_text`, `create_thread_from_text` add `_meta: { ui: { resourceUri }, 'ui/resourceUri': resourceUri, 'openai/outputTemplate': resourceUri }`, with the URI from `uiResourceUri('thread')`.
2. `callTool`: a tool may define `resultMeta(body, ctx)`; its return value becomes the result `_meta`. `get_draft` sets `_meta["x-thread/outline"]` (D8) from `outline()` in `server/draft-stats.js`. `content` and `structuredContent` stay byte for byte as today (test: compare with and without the change).
3. Tests: `tools/list` validates against the vendored schema; the four tools carry the same URI in all three keys; that URI is in `resources/list` and readable; `get_draft` result has the outline in `_meta` and unchanged `content`; the SDK client test (`mcp-sdk-client.test.js`) still lists and calls tools.
4. `docs/agents/mcp.md`: a short "Views in Claude and ChatGPT" section: which tools show a view, that the host asks once before showing it, and that text-only clients get the same text as before.
5. Done when: tests pass; after merge production READY and smoke green (manifest step included). Write "Not checked: real render in Claude and ChatGPT" in the epic with the one thing Shaked can do (section 7, last item).

### Task 5. Drafts list view (Sonnet)
Files: new `server/mcp/ui/drafts.js`, `server/mcp/ui/index.js`, `server/mcp/tools.js`, tests as in Tasks 1 and 3.
1. One row per summary: title (`dir="auto"`, "Untitled" when empty), posts count, total characters, a warning chip "n over 280" when `over_limit_count` > 0, images count, "Published" badge with date or "Updated <relative date>" (from `updated_at`, in `hostContext.locale`).
2. Row actions: "Open in editor" (`openLink(editorBase + id)`), "View thread" (calls `get_draft` through `callTool` and shows the thread rendering from Task 3 inside the same view, with "Back to list"). The drafts view therefore inlines the thread render functions.
3. Empty list: "No drafts yet". `list_drafts` with `detail: 'full'` also renders (posts ignored).
4. Link `list_drafts` (three keys, as Task 4); `resultMeta` adds `x-thread/editorBase`.
5. Tests: Playwright with 0, 1 and 30 drafts, Hebrew titles, dark and light; "View thread" sends `tools/call` for `get_draft` with the row id and renders the fixture answer; a `get_draft` error shows the error text. API: link and meta present; `structuredContent` unchanged.
6. Done when: tests pass; view under 64 KB; production READY and smoke green.

### Task 6. Share link card (Haiku)
Earns its place: `create_share_link` returns two URLs and an expiry that users copy by hand today.
Files: new `server/mcp/ui/share.js`, `server/mcp/ui/index.js`, `server/mcp/tools.js`, tests.
1. Card: "Preview link" and "Markdown link" as read-only text fields (select on focus) with an "Open" button each (`openLink`); "Works once" or "Works until it expires"; expiry as a countdown and the local time; after expiry the card says "Expired".
2. A "Copy" button only when `hostContext` or the sandbox allows clipboard write (`_meta.ui.permissions.clipboardWrite` is declared; if `navigator.clipboard.writeText` throws, the button says "Select and copy" and selects the field).
3. Link `create_share_link`. Tests: Playwright countdown with a fake clock; one-time and reusable fixtures; the token appears only inside the two URLs the result already holds.
4. Done when: tests pass; production READY and smoke green.

### Task 7. Write actions in the views (Sonnet; held: Q2 default is read-only first, start only when Shaked says so)
1. Share card: "Stop this link" calls `revoke_share_link` through `callTool` after an in-view "Are you sure?" step. Thread view: "Create share link" (calls `create_share_link` with defaults, then shows the Task 6 card). Nothing that deletes a draft or publishes it.
2. Hosts may ask the user before a view's tool call; the view shows "Waiting for your OK in the chat" while the call is open.
3. Tests: Playwright checks each button sends exactly one `tools/call` with the right arguments, and nothing is sent without the confirm step.
4. Done when: tests pass; production READY and smoke green.

### Task 8. Live embedded tweets (T8, Haiku; after the card ships, per the Q1 default)
1. Add `https://platform.twitter.com` to `resourceDomains` and `frameDomains` (and the hosts Opus finds `widgets.js` needs; check with a Playwright run that records the requests), load `widgets.js` only when a post has a tweet, keep the D5 card as fallback when it fails or the host blocks frames.
2. Tests: the D5 card still renders when the script is blocked; no X request when no post has a tweet.
3. Done when: tests pass; production READY and smoke green.

### Task 9. Finish (Haiku)
1. `docs/agents/mcp.md`, `public/llms.txt`, `docs/features/` describe the views; `docs/plans/current.md` moves this plan to "Completed".
2. In the epic: evidence for section 6, and the open questions for Shaked from D6 (noise) if any user saw too many cards.
3. Close the epic.

## 6. Finished when

- `resources/list` lists the views; `resources/read` returns them with `text/html;profile=mcp-app` and the CSP of D4 (API tests, vendored schema).
- `get_draft`, `create_draft`, `split_text`, `create_thread_from_text`, `list_drafts`, `create_share_link` carry `_meta.ui.resourceUri` and `openai/outputTemplate`; their `content` and `structuredContent` are unchanged (API tests).
- The views render English, Hebrew and mixed drafts, images, embedded tweets (card), dark and light, at 390 px, with no network request except Blob images, against both the hand-written host and the official `AppBridge` (Playwright, required job).
- Production serves this commit's views (deployed smoke step from Task 2).
- Every task row in the epic is `merged` or `dropped`; the epic is closed.

## 7. Questions for Shaked (each has a default; work does not wait)

Q1. Embedded tweets inside the chat view. What the user sees: a draft post that quotes a tweet shows either a simple card with the link, or the real tweet as on X.
- A: card with the link and an "Open on X" button. Nothing loads from X.
- B: the real tweet. The view loads X's script and frame, so X sees that this person viewed that tweet, and some hosts may block it (Claude limits embedded frames for unlisted connectors).
- Recommendation: A, because it needs no third-party script and works in every host. Default: A first (card), then Task 8 (real tweets) follows after the card version works.
- Default chosen by the agent, 2026-11-14 (Shaked can change it): A first. Shaked wants embedded tweets, so B (real tweets) comes later as Task 8 (T8).

Q2. Buttons that change things inside the views. What the user sees: the views only show and open links, or they also have "Create share link" and "Stop this link" buttons.
- A: read-only views first (open links, view a thread from the list).
- B: add the two share buttons (Task 7). Each click may still show the host's own confirm.
- Recommendation: A first, then B after you have seen the views. Default: A (Task 7 stays held until Shaked asks for write buttons).
- Default chosen by the agent, 2026-11-14 (Shaked can change it): A. Read-only first. Task 7 (write buttons) is held until Shaked says to start it.

Q3. How a robot checks the views on production. The deployed smoke test cannot sign in to MCP (an MCP sign-in needs a person on the consent page).
- A: a public address `/api/mcp/ui-manifest` lists each view's name and fingerprint, no HTML and no user data. The smoke test compares it with the commit.
- B: the MCP server answers `resources/list` and `resources/read` for the static views and the skill file without sign-in. Anyone can read the view code (it holds no user data); the smoke test reads the real MCP answer.
- C: no production check beyond today's; the views are checked only before merge.
- Recommendation: A, because it keeps every MCP request signed in and still proves production. If nobody answers, A.
- Default chosen by the agent, 2026-11-14 (Shaked can change it): A, the public hash manifest (`/api/mcp/ui-manifest`, see D11).

One thing Shaked can do by hand (optional, not blocking): after Task 4 is on production, open a chat in Claude (claude.ai, connector "x-thread-draft-tool" on) and in ChatGPT (developer mode connector), ask "show my draft <title>", click "Allow", and say in the epic whether the thread card appeared. Automated route checked: the official `AppBridge` test (Task 1) runs our view in a real browser, but no robot can sign in to claude.ai or chatgpt.com.

## 8. Risks

1. Hosts differ and change. ChatGPT details were read from search summaries, not OpenAI's pages (not reachable here); Claude and ChatGPT cache templates differently; ChatGPT Android has a reported blank-view bug. Mitigation: standard keys plus the OpenAI alias, hashed URIs (D3), text fallback unchanged (rule 11), the official `AppBridge` test.
2. Draft text inside a host page is an injection surface. Mitigation: rules 9 and 10, XSS fixtures, grep test, Opus line review, one exact image host (a wildcard Blob host would also open `script-src`).
3. No robot sees a real render, and a card on every `get_draft` may be noisy while the model edits. Mitigation: Task 2 smoke, Playwright with both hosts, Shaked's optional check, D6 fallback (`show_thread` tool).
4. Collision with open work: private-drafts T5 to T7 touch `server/mcp/tools.js` and the counting rules. Start after them, or merge `main` in before each task.
5. Size and test budget: views are inlined code; keep each under 64 KB and the new tests inside the 55 s budget.

Sources: modelcontextprotocol/ext-apps `specification/2026-01-26/apps.mdx` and README (raw.githubusercontent.com); claude.com/docs/connectors/building/mcp-apps (getting-started, quickstart, troubleshooting); search summaries of developers.openai.com/apps-sdk/mcp-apps-in-chatgpt, sunpeak.ai migration guide, community.openai.com Android report.

## 9. Starting prompt for the executor session

```
Read AGENTS.md, then docs/plans/mcp-apps.md sections 1 to 4 and 7.
Read the epic and find the first task that is not merged or skipped. Do that task only, as section 5 says.
You are the coordinator: give the coding to the model the task names, the review to an Opus agent,
and every doubt to an Opus agent. Use a Sonnet agent when Haiku fails a step twice.
Open and merge pull requests without asking; each task goes to production when it is ready.
Do not ask Shaked design questions. Owner-only items go to the epic under "Needs from Shaked".
```
