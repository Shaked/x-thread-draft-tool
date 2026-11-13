# MCP for Claude Code, Claude, Codex and ChatGPT: finish, harden, verify

Written 2026-11-12 23:50 UTC for an executor that follows instructions literally.
Procedures named `P-...` are in [hardening-finish.md](./hardening-finish.md) section 5. Rules named
`E...` are in [hardening-finish-part2.md](./hardening-finish-part2.md) section 2. They apply here unchanged.

**Task numbers for the net-lines rule.** Step Mn is Task n (M0 = Task 0 ... M12 = Task 12). So a PR
body line such as `Implements docs/plans/mcp-clients.md Task 0` passes `scripts/net-lines.mjs`. The
same rule applies to `docs/plans/hardening-finish.md`, whose Tasks are 20 to 42.

**What this plan is.** The MCP server already exists (`POST /api/mcp`, 11 tools, OAuth with GitHub
sign-in). This plan does not rebuild it. It closes the gaps that stop the four clients from
connecting, adds the missing tools, hardens two weak spots, and makes setup one copy-paste.

**How to use this file**

1. Read [AGENTS.md](../../AGENTS.md) ("Working in this repo").
2. Read sections 1 to 5 of this file in full.
3. Do the steps of section 6 in order, one step at a time, one PR per step.
4. After every step: update the ledger (section 2), then run the Checkpoint (section 2).
5. Never ask Shaked a question. Questions go to Opus (P-OPUS). If Opus says owner-only, park the
   step, write the owner action in the ledger, and take the next step.

---

## 1. Rules card

A hook prints this card at session start and after every context summary (section 2, "Hook").

MCP RUNBOOK RULES CARD (docs/plans/mcp-clients.md). Applies only if you were asked to execute that plan.
1. Run the Checkpoint (plan section 2) at session start, after every step, on every wake-up, after a context summary, and before every merge.
2. The ledger issue "MCP clients: run ledger" is your memory. Its first table row "NOW" says where you are. Rewrite it after every step and before you end a turn.
3. Before you end a turn that waits, call send_later ONCE with the P-SELF note (plan section 2). Never sleep. Never check the same thing twice in one turn.
4. Codex answers in 2 to 3 minutes, as a PR COMMENT. After "@codex review": send_later 3 minutes, end the turn. Read get_comments, get_review_comments and get_check_runs. Reply on and resolve fixed threads.
5. One step per PR. Branch from the latest main. Never commit with --no-verify. Never skip, disable or weaken a test.
6. Merge only via P-MERGE: merge commit, all checks green, Codex P0/P1 handled. Never squash. Never approve.
7. Never ask Shaked. Ask Opus (P-OPUS). Owner-only work is parked in the ledger and you continue.
8. Never print, paste or commit a secret. Never change GitHub, Vercel or Neon settings.
9. Security rules of plan section 4 (S-1 to S-6) are not negotiable. A change that breaks one is wrong even if a client then connects.
10. Run `date -u` for the time. No model names in commits, PR text or code.

---

## 2. How not to forget: Checkpoint, ledger, P-SELF, hook

You lose context on every summary. Three things carry it for you. Use all three.

**Ledger.** One GitHub issue, title `MCP clients: run ledger`, first body line `<!-- mcp-ledger:v1 -->`.
Find it with `mcp__github__list_issues` (state open). If it does not exist, you are at step M0.
Body layout, always in this order:

```
<!-- mcp-ledger:v1 -->
Plan: docs/plans/mcp-clients.md

| NOW | value |
|---|---|
| Step | M<n> |
| PR / head | #<n> / <sha7>  (or "none") |
| Waiting for | <one thing, or "nothing"> |
| Next action | <one sentence a stranger could do> |
| Written | <date -u output> |

## Steps        (the tracker table of section 5, with the State column kept current)
## Owner actions (checkboxes, each says what to click, where, and what it unblocks)
## Decisions    (one line each: date, step, what Opus or the plan decided)
## Follow-ups   (things found and deliberately not done)
```

Rewrite the body with `mcp__github__issue_write` after every step and before every turn end.
Add a comment only for a problem or a decision. Never keep state only in your head or in chat.

**Checkpoint (K1 to K5).** Run it at session start, after every step, on every wake-up, after a
context summary, before every merge, and whenever you are unsure.

1. **K1** Read the Rules card (section 1).
2. **K2** Read the ledger. The NOW table is where you are.
3. **K3** Check that NOW is true: read the PR (`pull_request_read` `get`), its checks and Codex's
   comments. If reality differs, fix the ledger first.
4. **K4** Read the section 6 text of the step named in NOW, in full. Do its next unfinished
   numbered item only.
5. **K5** Rewrite the ledger (NOW and the step's row). Go to K1.

**P-SELF: post a note to yourself before every wait.** When a turn must end to wait (Codex, CI, a
deployment), call `mcp__claude-code-remote__send_later` exactly once, then end the turn. Use this
text, filled in. It must stand alone, because you may read it after a summary:

```
MCP RUNBOOK wake-up. Plan: docs/plans/mcp-clients.md. Ledger: issue #<n>.
Step M<n>, PR #<n>, head <sha7>. Waiting for: <thing>. Asked at <HH:MM UTC>.
First: run the Checkpoint (plan section 2). Then: <next action in one sentence>.
Remember: Codex answers in a PR comment within 3 minutes. Do not sleep. Do not re-check twice.
```

Delays: Codex 3 minutes (then E-CODEX's table), CI or a Vercel deployment 5 minutes. Never longer
than 5 minutes for Codex.

**Also** mirror the steps in the local task list (TaskCreate/TaskUpdate), the current one `in_progress`.

**Hook.** `.claude/settings.json` runs `scripts/runbook-reminder.mjs`. At session start, on resume
and after a compaction it prints the Rules card. On every prompt (wake-ups included) it prints one
line. It prints nothing once the `RULES-CARD` block is removed from this file (step M12).
Do not edit `.claude/settings.json` or the script, except in M12 as written. Codex reads
`AGENTS.md` by itself, and `AGENTS.md` points here; Codex needs no hook.

---

## 3. State (verified 2026-11-12 23:40 UTC on `main` at `65e7271`)

**In place**

- `server/mcp/server.js`: `POST /api/mcp`, stateless Streamable HTTP, JSON responses, protocol
  versions `2026-07-28`, `2025-11-25`, `2025-06-18`. GET and DELETE answer 405.
- `server/mcp/tools.js`: 11 tools (`list_drafts`, `get_draft`, `create_draft`, `update_draft`,
  `duplicate_draft`, `export_draft`, `split_text`, `create_share_link`, `add_image_from_url`,
  `publish_draft`, `delete_draft`). Each calls the REST handler in-process as the token's user.
- `server/routes/oauth.js`, `server/oauth/*`: OAuth 2.1 authorization server. Protected-resource
  metadata (RFC 9728), server metadata (RFC 8414), dynamic client registration, client-ID metadata
  documents, PKCE S256 only, consent page, 1-hour access tokens bound to one resource, rotating
  refresh tokens (90 days), revocation. Sign-in is the app's own GitHub sign-in.
- Settings page (`src/pages/TokensPage.jsx`): shows the MCP URL and "Connected apps" with revoke.
- Tests: `tests/api/mcp.test.js`, `oauth.test.js`, `oauth-tokens.test.js`, `grants.test.js`.

**Gaps this plan closes**

| ID | Gap | Evidence | Step |
|---|---|---|---|
| G1 | Claude Code will be refused at authorize. Its metadata document lists `http://localhost/callback` and `http://127.0.0.1/callback` and it listens on a random port. Our match is exact (`client.redirect_uris.includes(redirectUri)` in `authorizeGet`). | Code read; Claude connector docs (section 9) | M1 |
| G2 | The token endpoint refuses a code exchange without `resource`. A client that omits it cannot finish. | `exchangeCode` in `server/routes/oauth.js` | M1 |
| G3 | A request without `MCP-Protocol-Version` gets 400. The 2025-06-18 text says to assume `2025-03-26`. `2025-03-26` is not in our list. | `checkProtocolVersion` | M2 |
| G4 | Client behaviour was never tested end to end. It is now proven by contract tests with mocks, not by a person. | `tests/api/mcp-clients.test.js`, `tests/api/mcp-contract.test.js`, `.claude/skills/e2e-contract-tests.md` | M11 |
| G5 | Tools have no `title` and incomplete annotations. ChatGPT and Claude use them to decide what needs a confirmation. | `listTools()` output | M3 |
| G6 | `create_share_link` returns a bare token, not a link. Draft results carry no link to the editor. | `createShareToken` returns `{ token }` | M3 |
| G7 | Not reachable through MCP: who am I, remove an image, attach an uploaded image to a post. | Route list vs tool list | M4 |
| G8 | An agent must resend the whole `posts` array to change one post. That loses images when the model forgets a field. No one-call "text to thread draft". | Tool list | M4, M5 |
| G9 | Nothing fails when someone adds a REST route and forgets MCP. | No coverage test | M4 |
| G10 | The client-metadata fetch checks the address, then fetches by name. DNS rebinding can point it at a private address (old bug B12). The same in `server/remote-image.js`. | Old ledger follow-up | M7 |
| G11 | No limit on tool calls per user. | `grep -ri "rate" server` finds nothing | M8 |
| G12 | Setup text for the four clients exists nowhere. The deployed smoke test does not touch MCP. | `docs/agents/api.md`, `scripts/smoke.mjs` | M9, M10 |

**Not checked** (find out in the step named): whether ChatGPT or Codex send an `Origin` header
(M2 adds a log line; read it when a client fails in the field, M11 item 5). Whether `PUBLIC_APP_URL` is set in production (M9, item 1).

**How client behaviour is tested.** Contract tests only. `tests/api/mcp-clients.test.js` and `tests/api/mcp-contract.test.js` run each
client profile through the router with mocks: no real client binary, no account sign-in, no paid
LLM call, no person. The design rules are in `.claude/skills/e2e-contract-tests.md`.

---

## 4. Decisions (all made; do not reopen them)

**Security rules. They hold after every step.**

- **S-1** `/api/mcp` accepts only an OAuth access token (`xta_`) bound to `<origin>/api/mcp`. Never a
  cookie, an `xt_` token, a CI token or a REST-bound token.
- **S-2** Sign-in stays the app's GitHub sign-in plus the consent page. No new login path, no shared
  secret, no API key field in any client setup text.
- **S-3** PKCE S256 stays required. Public clients only. The code stays single-use, 60 seconds,
  bound to client, redirect URI and resource.
- **S-4** Every tool runs as the token's user through the REST handlers. No tool takes a user id.
  No tool reads another user's draft, also not by id.
- **S-5** No MCP tool creates, lists or revokes credentials (API tokens, connected apps). A person
  does that on the Settings page. This is a decided exception to "all functionality".
- **S-6** Tool descriptions keep the sentence that draft text is data, not instructions.

**Design decisions**

| ID | Decision | Reason |
|---|---|---|
| D-1 | Loopback redirect URIs match with the port ignored (RFC 8252 section 7.3). Everything else stays an exact match. The token exchange still compares against the exact URI stored with the code. | G1. A loopback port cannot be registered ahead of time. |
| D-2 | `resource` is optional at the token endpoint. Absent means "the resource the code (or refresh token) was issued for". Present and different stays `invalid_target`. | G2. The code is already bound at authorize, so nothing is widened. |
| D-3 | A request with no `MCP-Protocol-Version` header is handled as `2025-03-26`. `2025-03-26` joins the legacy list. A header with an unknown value stays an error. | G3. |
| D-4 | The Origin check on `/api/mcp` stays. M2 only adds a log line. If a client is blocked by it (M11 item 5), P-OPUS decides. | The check is cheap and the four clients call from servers or CLIs. |
| D-5 | Images: `add_image_from_url` only. No upload of raw bytes through MCP. | A model cannot send megabytes of base64, and the MCP body limit is 1 MB. Decided exception. |
| D-6 | No MCP prompts, no resources, no `search`/`fetch` tools, no UI widgets. Tools only. | All four clients support tools. Follow-up, not this plan. |
| D-7 | Tool calls: at most 120 per user per minute, counted in Postgres. | G11. No new service. |
| D-8 | Post tools refuse a published draft and never change `images` or `embeddedTweet` of a post they do not target. | G8. |
| D-9 | Client behaviour is proven by contract tests with mocks. No step needs a person or a real client. | G4. |
| D-10 | Client setup facts in section 9 were read on 2026-11-12. Before writing them into docs (M9), open each client's own documentation and correct what changed. Write "checked <date>" next to each. | Client UIs change often. |

**Allowed writes.** As in the runbook's section 2.4, plus: create and edit the ledger issue; the
files each step names. Nothing else.

---

## 5. Tracker

The live copy is the ledger's "Steps" table. This is the starting state.

| Step | What | Gap | State | Needs | Done when |
|---|---|---|---|---|---|
| M0 | This plan on `main`; ledger issue created | none | done (#78, ledger #80) | none | merged; ledger exists |
| M1 | OAuth: loopback port, optional `resource`, client-profile tests | G1, G2 | done (#81) | M0 | merged, production READY, smoke green |
| M2 | Transport: missing version header, `2025-03-26`, Origin log line | G3 | done (#82) | M1 | merged, production READY, smoke green |
| M3 | Tool titles, annotations, links in results | G5, G6 | done (#83) | M2 | merged, production READY, smoke green |
| M4 | New tools: `whoami`, `remove_image`, `postId` on `add_image_from_url`, `create_thread_from_text`; coverage test | G7, G8, G9 | done (#84) | M3 | merged, production READY, smoke green |
| M5 | Post tools: `add_post`, `update_post`, `remove_post`, `move_post` | G8 | done (#85) | M4 | merged, production READY, smoke green |
| M6 | Export with numbering through REST and MCP | G7 | done (#86) | M5 | merged, or `done (no change)` with the reason |
| M7 | Pin the checked address in both server-side fetches | G10 | done (#87) | M2 | merged, or parked by Opus |
| M8 | Tool-call rate limit | G11 | done (#88) | M5 | merged, production READY, smoke green |
| M9 | `docs/agents/mcp.md`, README, `llms.txt`, smoke steps for MCP discovery | G12 | done (#89) | M5 | merged; smoke shows the new steps PASS on production |
| M10 | Settings page: "Connect an AI app" with the four recipes | G12 | done (#90) | M9 | merged, look `APPROVE` (P-UI-REVIEW) |
| M11 | Client contract suite, refresh resource fix, SDK client test | G4 | done (#92, #98, #99, #100, #101) | M9 | contract suite and SDK test green in CI; refresh fix merged |
| M12 | Finish: docs, switch the hook off, final ledger | none | done (#91) | all above | merged; ledger final |

M7 is independent of M3 to M6. Take it while another PR waits.

---

## 6. Steps

Every code step uses the same frame. It is not repeated below.

- **Frame A (start):** `scripts/agent-pr.sh branch claude/mcp-m<n>-<slug>`; `npm ci` once per session.
- **Frame B (finish):** add `docs/changelogs/<UTC YYYYMMDD-HHMMSS>-<slug>.md` (1 to 5 lines);
  `npm run test:unit` green; commit (the hook runs lint, build and tests); P-PR; P-CODEX with
  E-CODEX timing and P-SELF; P-MERGE; P-PROD for runtime changes; ledger; Checkpoint.
- A new test file under `tests/api/` starts with `// @vitest-environment node` (rule E8).
- If the same failure survives two honest attempts: P-OPUS. Do not try a third variation alone.

### M0. Plan on `main`, ledger created
1. The plan is on branch `claude/ecstatic-goldberg-mm3yvs` with its changelog file. Open a PR to
   `main` (P-PR from the "open" item). P-CODEX, P-MERGE. Docs-only: the production build is skipped.
2. Create the ledger issue with the body layout of section 2 and the tracker of section 5.
3. Add one comment on issue #60: `MCP work continues in #<ledger>. This ledger is unchanged.` plus the footer.

### M1. OAuth: loopback port and optional `resource`
**Done when:** the four client profiles pass in `tests/api/mcp-clients.test.js`; merged.

1. In `server/oauth/clients.js` add and export `redirectUriAllowed(registered, requested)`:
   - true when `registered.includes(requested)`;
   - else true only when `requested` passes `isValidRedirectUri`, is `http:` with hostname
     `localhost` or `127.0.0.1`, and some registered URI is `http:` with the **same hostname, same
     pathname and same search**, differing only in port;
   - else false. `https` URIs never get the port rule.
2. In `authorizeGet` (`server/routes/oauth.js`) replace `client.redirect_uris.includes(redirectUri)`
   with `redirectUriAllowed(client.redirect_uris, redirectUri)`. Change nothing else there: the
   consent page shows the real host and port, and the code row stores the real URI.
3. In `exchangeCode`: read `resource` as optional. Absent: use `row.resource` everywhere `resource`
   was compared. Present and different: `invalid_target`, as today. Keep the order of the checks
   (bindings before anything else) and keep the replay rule that revokes the grant. Fix the error
   text to `code, redirect_uri, client_id and code_verifier are required`.
4. Read the refresh path (`token` and `rotate`). If it requires `resource`, apply D-2 there the same
   way. If it does not, change nothing and say so in the PR body.
5. Tests. New file `tests/api/mcp-clients.test.js`. Reuse the helpers that `tests/api/oauth.test.js`
   and `tests/api/mcp.test.js` use (session cookie, metadata resolver stub). For each profile run the
   whole path: discovery (401 header, both metadata documents), client setup, authorize, consent,
   token, `initialize`, `tools/list`, one `tools/call`, refresh, then `tools/call` again.

   | Profile | Client identity | Redirect URI at authorize | `resource` at token | Version header |
   |---|---|---|---|---|
   | claude-web | registration with `https://claude.ai/api/mcp/auth_callback` | the same | sent | `2025-11-25` |
   | claude-code | metadata document listing `http://localhost/callback` and `http://127.0.0.1/callback` | `http://localhost:49152/callback` | sent | `2025-11-25` |
   | codex | registration with `http://127.0.0.1:1455/callback` | the same | **omitted** | `2025-06-18` |
   | chatgpt | registration with `https://chatgpt.com/connector_platform_oauth_redirect` | the same | sent | `2025-06-18` |

   Negative tests, all must stay refused: loopback with another path; `http://localhost.evil.test:1/callback`;
   an `https` URI with another port; a present but wrong `resource`; a code exchange whose
   `redirect_uri` has another port than the authorize request used; a `plain` PKCE method.
6. An existing test asserts that `resource` is required at the token endpoint. D-2 changes that
   behaviour on purpose. Change only that assertion and name it in the PR body under "Behaviour changed".
   This is the only kind of test edit this plan allows.
7. Update the `docs/agents/api.md` auth section in two sentences (loopback port, optional `resource`). Frame B.

### M2. Transport tolerance
**Done when:** a request with no version header works as `2025-03-26`; merged.

1. `server/mcp/server.js`: add `'2025-03-26'` to `LEGACY_VERSIONS` and `SUPPORTED_VERSIONS`. In
   `checkProtocolVersion` remove the "header is required" refusal: no header means legacy
   (`modern: false`). An unknown header value stays `-32022`. The `2026-07-28` rules are untouched.
2. In `checkOrigin` add before the 403: `console.warn('[mcp] refused origin', new URL(requestOrigin).host)`
   inside a try/catch. Log the host only, never a header value or a token.
3. Tests in `tests/api/mcp.test.js`: change "requires the version header on everything except
   initialize" to the new behaviour (name it under "Behaviour changed"); add `initialize` with
   `2025-03-26` answering `2025-03-26`. Add the codex profile variant "no version header" to
   `mcp-clients.test.js`. Frame B.

### M3. Tool metadata and links
**Done when:** every tool has a title and four annotation hints; share and draft results carry links; merged.

1. Give each tool a `title` (2 to 4 words, sentence case) and all four hints. `listTools()` returns `title` too.

   | Tool | readOnlyHint | destructiveHint | idempotentHint | openWorldHint |
   |---|---|---|---|---|
   | `list_drafts`, `get_draft`, `export_draft`, `split_text` | true | false | true | false |
   | `create_draft`, `duplicate_draft`, `create_share_link` | false | false | false | false |
   | `update_draft` | false | false | true | false |
   | `add_image_from_url` | false | false | false | true |
   | `publish_draft`, `delete_draft` | false | true | true | false |

2. `create_share_link`: the result keeps `token` and adds `preview_url`
   (`<origin>/x-thread-preview/<token>`) and `markdown_url` (`<origin>/api/share/<token>.md`). Say in
   the description that each link works once in total. Build them in the tool from `ctx.origin`
   (add `origin` to `ctx` in `callTool`); do not change the REST response.
3. Results of `get_draft`, `create_draft`, `update_draft` and `duplicate_draft` add `url`, the editor
   link for that draft. Read `src/App.jsx` for the editor route. Do not guess it.
4. Extend the server `INSTRUCTIONS` by one sentence: "To turn long text into a draft, call
   create_thread_from_text; to change one post, use the post tools." Add it in M5, not here, so the
   text never names a tool that does not exist yet.
5. Tests: the "11 draft tools" test also checks title and the four hints on every tool; link tests. Frame B.

### M4. New tools and the coverage test
**Done when:** the four additions work; a REST route without a tool or an exclusion fails a test; merged.

1. Tools (all through `ctx.rest`, never SQL):

   | Tool | Arguments | Does | Hints (ro/destr/idem/open) |
   |---|---|---|---|
   | `whoami` | none | `GET /auth/me`; returns the login only | true/false/true/false |
   | `create_thread_from_text` | `text` (required), `title`, `max_chars` | `POST /threads/split`, then `POST /drafts` with the posts (`withPostIds`) | false/false/false/false |
   | `add_image_from_url` | adds optional `postId` | With `postId`: first read the owned draft, refuse an unknown post or one with 4 images, then upload, then `PATCH` the draft with `{ url }` appended to that post | unchanged |
   | `remove_image` | `draftId`, `url` (both required) | Read the owned draft; `PATCH` it without that url in any post; then `DELETE /images` with `{ url }` only if no other draft of the user (duplicates included) and no remaining post still uses that url. Same check as `deletableImageUrls` in `server/routes/drafts.js`. | false/true/true/false |

   `whoami` not checked: confirm in `server/session.js` that the in-process caller satisfies `/auth/me`. If not, P-OPUS.
2. Give every tool a `rest` field: the list of REST routes it covers, for example `['POST /drafts']`.
3. New test `tests/api/mcp-coverage.test.js`: for every entry of `ROUTES` (`server/router.js`),
   `"<METHOD> <path>"` is in some tool's `rest` list or in this fixed exclusion map. The test fails
   on a route in neither, and on an exclusion that names a route which no longer exists.

   | Excluded route | Reason |
   |---|---|
   | `/auth/*`, `/auth/device/*`, `/oauth/*`, `/.well-known/*` | Sign-in and OAuth protocol |
   | `/tokens`, `/tokens/:id`, `/grants`, `/grants/:id` | S-5 |
   | `POST /images` | D-5 |
   | `GET /share/:token` | Public one-time read; the link is the product |
   | `GET /openapi.json`, `GET /health`, `POST /mcp` | Not user functions |

4. Tests for each tool, including: another user's draft is "not found" for `remove_image` and for
   `add_image_from_url` with `postId`. Update `docs/agents/api.md`. Frame B.

### M5. Post tools
**Done when:** one post can be added, changed, removed and moved without resending the others; merged.

1. One private helper `editPosts(ctx, id, change)`: `fetchOwnedDraft`; refuse when `is_published`
   ("This draft is published. Duplicate it to edit."); `change(posts)` returns the new array or an
   error text; `PATCH /drafts/:id` with `{ posts }`. The REST handler stays the only validator.
2. Tools:

   | Tool | Arguments | Behaviour |
   |---|---|---|
   | `add_post` | `id`, `text`, optional `after_post_id` | New post with a fresh id, `images: []`, `embeddedTweet: null`. Without `after_post_id` it goes last. Unknown `after_post_id`: error. |
   | `update_post` | `id`, `post_id`, `text` | Changes `text` only. Images and embedded tweet stay. |
   | `remove_post` | `id`, `post_id` | Removes the post. Refuse to remove the last post. Its images: after the PATCH succeeds, delete each with `DELETE /images` only if no other draft and no remaining post uses that url (same check as `deletableImageUrls`). |
   | `move_post` | `id`, `post_id`, `position` (1-based) | Moves the post. Out of range: error. |

   Hints: all `readOnlyHint: false`, `openWorldHint: false`; `remove_post` `destructiveHint: true`;
   `update_post` and `move_post` `idempotentHint: true`.
3. Add the M3 item 4 sentence to `INSTRUCTIONS`. Add each tool's `rest` field (`PATCH /drafts/:id`).
4. Tests: each tool; untouched posts are byte-equal before and after; another user's draft; a
   published draft; a 281-character `text` is refused by the MCP argument schema (`maxLength: 280`, `server/mcp/tools.js`). REST does not check post length today (`validPosts` in `server/routes/drafts.js` checks only that `posts` is an array). Whether REST should is a follow-up for P-OPUS, not part of M5. Frame B.

### M6. Export with numbering
**Done when:** the numbering the UI offers is available to agents, or the reason it is not is in the ledger.

1. Read `exportDraft` in `server/routes/drafts.js` and `formatForClipboard` in `src/utils/exportFormats.js`.
2. If the REST export cannot number posts the way the UI's "copy with numbering" does: add query
   `numbered=true` to the `text` format in REST, in `server/openapi.js`, and as boolean `numbered` on
   `export_draft`. Same output as the UI for the same draft; test it with one fixture.
3. If it already can: ledger `done (no change)` with the line number that proves it. No PR.

### M7. Pin the checked address (old bug B12)
**Done when:** merged, or parked by Opus with the reason in the ledger.

1. P-OPUS first. Ask for the design in under 40 lines of code: "resolve once, refuse if any address
   is private, connect to exactly that address with the original host name for TLS, no redirects",
   usable by `fetchMetadataDocument` (`server/oauth/clients.js`) and `server/remote-image.js`.
   Paste both functions into the question.
2. Implement exactly what Opus answers, as one shared helper. Keep the size cap, the 3-second
   timeout and the no-redirect rule.
3. Tests with the resolver stub: a name that resolves public first and private second is refused;
   existing tests of both callers stay green without edits. Frame B.

### M8. Rate limit
**Done when:** the 121st tool call of one user inside a minute returns a tool error; merged.

1. Migration `db/migrations/004_mcp_rate.sql`: table `mcp_rate_limits (user_id, minute timestamptz,
   calls integer, primary key (user_id, minute))`. `user_id` has the same type as `drafts.user_id`.
2. `server/mcp/rate.js`: one statement, `insert ... on conflict (user_id, minute) do update set
   calls = mcp_rate_limits.calls + 1 returning calls`, with `minute = date_trunc('minute', now())`.
   Returns false above 120.
3. Call it in `dispatch` for `tools/call` only, before `callTool`. Over the limit: an `isError` tool
   result "Rate limit reached: at most 120 tool calls per minute. Wait one minute." Not a JSON-RPC error.
4. Delete rows older than one day in the existing `cleanupExpired` (`server/oauth/tokens.js`).
5. Tests: limit reached; another user is not affected; the next minute works (insert an old row
   instead of waiting). `tests/api/migrate.test.js` may need the new table name. Frame B.

### M9. Docs and smoke
**Done when:** `docs/agents/mcp.md` exists; the deployed smoke test prints the new steps as PASS; merged.

1. Fetch `https://x-thread-draft-tool-preview.vercel.app/.well-known/oauth-protected-resource/api/mcp`
   with Vercel's fetch tool. Check that `resource` and `authorization_servers` use the host you
   asked. Never fetch production with that tool. Write the result in the ledger.
2. Apply D-10: open each client's documentation, correct section 9, note the date.
3. Write `docs/agents/mcp.md`: what the connector can do (the tool list, grouped: read, write,
   posts, images, sharing, destructive), the four setup recipes from section 9, what is not exposed
   and why (S-5, D-5, D-6), how to disconnect (Settings, Connected apps), and a troubleshooting table:

   | You see | Cause | Do |
   |---|---|---|
   | "Invalid redirect URI" page | The client's callback is not registered | Report the client and the URL on the ledger issue |
   | Sign-in lands on the home page | The authorize request was over 2,000 characters | Start the connection again; you are signed in now |
   | Works, then fails after about an hour | The client did not refresh | Disconnect and connect again; report it |
   | 403 "Cross-origin request blocked" | The client sent a browser Origin | Report it (D-4) |

4. Link it from `README.md`, `docs/agents/api.md`, `public/llms.txt` and `docs/features/platform-and-auth.md`.
5. `scripts/smoke.mjs`: three public steps (they need no account): `POST /api/mcp` without a token
   is 401 with a `www-authenticate` header naming the metadata URL; that metadata URL returns
   `resource` ending in `/api/mcp`; the authorization-server metadata lists `S256` and a registration
   endpoint. Run level 2 locally (`npm run dev:api`, then `npm run smoke`). Frame B.

### M10. Settings page: "Connect an AI app"
**Done when:** merged; P-UI-REVIEW says `APPROVE`.

1. In `src/pages/TokensPage.jsx`, next to the existing MCP URL: a short block with four entries
   (Claude, Claude Code, ChatGPT, Codex). Each: one or two lines from `docs/agents/mcp.md` and a copy
   button for the URL or the command. Reuse existing classes and theme variables. No new dependency.
2. One sentence under it: "You approve each app once with your GitHub sign-in. Remove it any time below."
3. Unit test for the copy text; update the screenshot harness if the page is in it.
   P-PREVIEW, P-UI-REVIEW at 390 px and desktop, light and dark. Frame B.

### M11. Client contract suite
**Done when:** items 1 to 4 are merged and green in CI, with no real client, no person and no LLM call.

1. Add the wire-level checks from `.claude/skills/e2e-contract-tests.md` in a new file `tests/api/mcp-contract.test.js`:
   a spec-following mock client (discovery from `WWW-Authenticate`, endpoints only from metadata,
   `state`, `iss` and the exact loopback port on the redirect), token fields and `cache-control: no-store`,
   refresh rotation at the wire level, error bodies. The 2026-07-28 transport stays covered by `tests/api/mcp.test.js`.
2. Refresh ignores `resource` today (`server/routes/oauth.js`, `rotate` in `server/oauth/tokens.js`).
   Fix it in its own PR, with a test that a wrong `resource` gets `invalid_target`.
3. Each tool's `inputSchema` compiles as strict JSON Schema (ajv 8.20.0 and ajv-formats 3.0.1, exact devDependencies).
4. The official MCP TypeScript SDK client (`@modelcontextprotocol/sdk` 1.32.2, exact devDependency), with its fetch set to the in-process `route()`, runs discovery, registration, authorize with scripted consent, token, initialize, tools/list, one tools/call and refresh, in `tests/api/mcp-sdk-client.test.js`. Own PR, after item 1.
5. When a client fails in the field: add its profile to the contract suite first, reproduce the failure
   there, then fix the server in its own PR (Frame A, Frame B). If the fix would break a rule S-1 to S-6: P-OPUS.
6. No test in this plan calls an LLM, a real client app or a person.

### M12. Finish
1. `docs/plans/current.md`: move this plan to "Completed / in place". Update `docs/features/platform-and-auth.md`.
2. In this file, delete the two marker lines `RULES-CARD:START` and `RULES-CARD:END` (keep the
   text). The hook then prints nothing. Remove the runbook line for this plan from `AGENTS.md`.
3. Ledger: final state, open owner actions, follow-ups. Frame B.

---

## 7. What Shaked has to do

Nothing for the client tests. They are contract tests and need no person. (The earlier manual
checks OM-1 to OM-5 were removed on 2026-11-13.)

---

## 8. Finished when

- M0 to M12 are `done` (M6 may be `done (no change)`, M7 may be parked by Opus).
- `npm run test:unit` is green on `main`, including `mcp-clients` and `mcp-coverage`.
- Production is READY with a passing smoke test that includes the MCP discovery steps.
- The client contract suite is green in CI (no owner action).
- Rules S-1 to S-6 hold; `tests/api/mcp.test.js` "authentication on /api/mcp" passes unedited.

---

## 9. Client facts (read 2026-11-12; correct them in M9, rule D-10)

`URL` is `https://x-thread-draft-tool.vercel.app/api/mcp`.

| Client | Setup | OAuth callback it uses | How it identifies itself |
|---|---|---|---|
| Claude (web, desktop, mobile) | Settings, Connectors, Add custom connector, paste `URL` | `https://claude.ai/api/mcp/auth_callback` | Metadata document when the server advertises it, else registration |
| Claude Code | `claude mcp add --transport http x-thread URL`, then `/mcp` and authenticate | `http://localhost:<random port>/callback` | Metadata document at `https://claude.ai/oauth/claude-code-client-metadata`, listing loopback URIs without a port |
| Codex CLI | `codex mcp add x-thread --url URL`, then `codex mcp login x-thread` | A loopback URI | Registration. Not checked: whether it sends `resource` |
| ChatGPT | Developer mode on, create a connector, paste `URL`, authentication OAuth | `https://chatgpt.com/connector_platform_oauth_redirect` | Registration or metadata document; sends `resource` |

Sources: `claude.com/docs/connectors/building/authentication`, `developers.openai.com/codex/mcp`, and
third-party guides for ChatGPT (OpenAI's own page was not read: do that in M9).

---

## 10. Starting prompt for a new session

```
Execute docs/plans/mcp-clients.md in Shaked/x-thread-draft-tool, step by step, until every step is
done or parked. Do not ask me anything; questions go to Opus (Agent tool, model "opus", prompt from
P-OPUS in docs/plans/hardening-finish.md). You may merge a PR when P-MERGE's conditions hold.

Until step M0 merges it, the plan is only on branch claude/ecstatic-goldberg-mm3yvs:
  git fetch origin claude/ecstatic-goldberg-mm3yvs main
  git show origin/claude/ecstatic-goldberg-mm3yvs:docs/plans/mcp-clients.md

Read first, in this order: AGENTS.md, the plan's sections 1 to 5, then docs/plans/hardening-finish.md
section 5 and docs/plans/hardening-finish-part2.md section 2. The tracker is the ledger issue
"MCP clients: run ledger" (step M0 creates it).

Five rules. Re-read them after every context summary:
1. Run the plan's Checkpoint (section 2) at start, after every step, on every wake-up.
2. Rewrite the ledger's NOW table after every step and before every turn end.
3. Before a turn ends to wait, send yourself the P-SELF note with send_later, once. Never sleep.
4. Codex answers in 2 to 3 minutes, in a PR comment. Reply on and resolve fixed threads.
5. Security rules S-1 to S-6 in section 4 win over "make the client connect".

When a step needs me, say in plain words what to click and where, add it to the ledger, and
continue with the next step.
```
