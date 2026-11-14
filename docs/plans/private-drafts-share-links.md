# Private drafts, timed share links, consent copy link, MCP summaries

Written 2026-11-14 11:45 UTC. Tracker: epic issue #111. For an executor that follows instructions literally.

## 1. Who does what

| Role | Model | Job |
|---|---|---|
| Executor | Haiku | Does one task at a time, exactly as written in section 5. |
| Judge | Opus | Reviews every pull request against the task's "Done when" list before merge. Answers `APPROVE` or `CHANGES` with a numbered list. |
| Adviser | Opus | Answers every doubt. The executor asks Opus, never guesses and never asks Shaked a design question. |
| Helper | Sonnet | Takes over one step when Haiku has failed the same step twice, or when a step needs code in more than three files at once. |

Start a model with the Agent tool (`model: "haiku"`, `"opus"` or `"sonnet"`). Give it the task section, the files named in it and the diff. Opus does not decide owner-only matters (money, secrets, deleting data, product behaviour not written here); those go to the epic under "Needs from Shaked".

## 2. Rules

1. Read `AGENTS.md` first. After T0 merges, read it again.
2. One task, one branch from the latest `main`, one pull request, one changelog file.
3. Procedures P-PR, P-CODEX, P-CI, P-MERGE and P-PROD are in [hardening-finish.md](./hardening-finish.md) section 5. Use them with three exceptions: where they say "ledger", use epic #111; the pull request body starts `Implements docs/plans/private-drafts-share-links.md Task <n> (T<n>)` (T2 is `Task 2 (T2)`, T3a is `Task 3 (T3a)`), because the `Net lines` check passes a pull request whose product code grows only when the body names a plan task as `docs/plans/<file>.md Task <number>`; Codex silence follows `AGENTS.md` (15 minutes), not the older 30-minute rule.
4. Before P-MERGE, the judge (Opus) must answer `APPROVE` for the head commit. Record the verdict as one line in the pull request description.
5. Each task ships on its own. When its pull request passes rule 4 and P-MERGE, merge it at once and run P-PROD (production deployment READY, deployed smoke test green). Do not wait for other tasks, and do not ask Shaked before opening or merging a pull request: he has approved both for every task here.
6. After each merge, update the task row in the body of #111 (PR number, state `merged`, production checked).
7. A test that changes because the behaviour changed on purpose is fine. Say which test and why in the pull request. Never delete an assertion without a replacement.
8. All checks in sections 5 and 6 run without a person: unit tests, API tests (`npm run test:api`), Playwright, the smoke script.

## 3. State (checked 2026-11-14 on `main` at `503daee`)

- `GET /api/drafts/:id` and `GET /api/drafts/:id/export` need no sign-in. Anyone who has a draft id reads the draft (`server/routes/drafts.js`, `getDraft` and `exportDraft`).
- The "Share" button copies `/draft/<id>` (`src/components/ShareButton.jsx`).
- `share_tokens` rows are one-time and never expire (`db/migrations/001_init.sql`, `server/routes/share.js`).
- The consent page is server HTML with `default-src 'none'`, so no script runs (`server/oauth/consent.js`). With no session, `GET /api/oauth/authorize` redirects straight to GitHub (`server/routes/oauth.js`, `authorizeGet`).
- MCP `list_drafts` returns every post of every draft. Post edit tools return the whole draft. Character counts are `text.length`.
- Not checked: whether Grok, ChatGPT or Claude finish the OAuth flow when the consent page is opened in a different browser than the one that started it.

## 4. Decisions (made; do not reopen)

| # | Decision | By |
|---|---|---|
| D1 | A "Sign in to continue" page is shown before GitHub. It has the copy-link field. | Shaked, 2026-11-14 |
| D2 | Share links are rows in `share_tokens` (not stateless signed URLs), so the owner can revoke one. | Shaked, 2026-11-14 ("yes" to the recommended option) |
| D3 | Default lifetime 3600 seconds. The sharer chooses another value in the UI, the API or MCP. Allowed range: 60 seconds to 7 days (604800). | Shaked (default), agent (range) |
| D4 | `list_drafts` returns summaries by default. Full posts on request. | Shaked, 2026-11-14 |
| D5 | The "X Thread" and "Agent link" buttons keep making one-time links. Those links now also expire. | Agent (no behaviour is removed) |
| D6 | Only the owner reads a draft by id. Anyone else, signed in or not, gets 404 (signed out: 401). | Shaked's request, 2026-11-14 |
| D7 | A shared draft is shown with the existing read-only page `/x-thread-preview/<token>`. The read-only editor view for other people is removed. | Agent (smallest change) |
| D8 | No text search tool, no drafts as MCP resources, no unpublish. | Agent |
| D10 | Every signed-in page has a sign-out button. Sign-out ends the session on the server, not only the cookie, and clears drafts cached in the browser. It ends this browser's session only. | Shaked, 2026-11-14 (button, real sign-out); agent (this browser only) |
| D11 | Signed-in pages share one bar: page actions, a small sign-out button and a hide control. On phones it is a fixed bottom bar at most 44 px high plus the safe area (the Playwright check allows 56 px in total); on wide screens it sits in the page header. The hide choice is kept in the browser only (`xt-bar`). Export is a button with a menu; the round export toggle is removed. See [bottom-bar.md](./bottom-bar.md). | Shaked, 2026-11-14 (bar on every page, smaller, hideable, phones included); agent (layout, Export as a menu on desktop too) |
| D9 | Image files stay readable by their storage URL. Hiding them is not in this plan. | Agent |

## 5. Tasks

Do them in this order: T0, T1, T2, T3b-1, T3b-2, T3, T3a, T4 to T7. T3b-1 and T3b-2 (the bottom bar and the Export menu) are written in [bottom-bar.md](./bottom-bar.md) (designed by Fable from measurements on a 390 px phone, 2026-11-14); T3b-1 comes first because it fixes the Share menu, which T2 left unusable on phones. Pull request bodies for them start `Implements docs/plans/private-drafts-share-links.md Task 3 (T3b-1)` and `... Task 3 (T3b-2)`.

### T0. Plan and rules on `main`
1. One pull request from `claude/magical-mayer-56qob1`: this file, the index, the changelog and the new `AGENTS.md`.
2. Done when: merged; #111 row T0 says `merged`.

### T1. Drafts are private
Files: `server/routes/drafts.js`, `src/pages/DraftEditor.jsx`, `src/components/ShareButton.jsx`, `tests/api/drafts.test.js` (the test "is public" changes on purpose), `tests/api/parity.test.js` and `tests/api/export-numbered.test.js` (both call export without a cookie today; sign in as the owner), `tests/api/router.test.js`, `scripts/smoke.mjs`, `server/openapi.js`, `docs/agents/api.md`, `public/llms.txt`, `docs/features/sharing-and-export.md`.
1. `getDraft` and `exportDraft`: call `requireUser(request)` and add `and user_id = $2` to the query. No row: 404 `Draft not found`.
2. `DraftEditor.jsx`: when the API answers 401, show "Sign in to open this draft" with the sign-in button. When it answers 404, show "Draft not found". Remove the code path that shows another person's draft read-only, and remove the `idbGet` fallback for a signed-out visitor. On a 401 or 404, delete `draft-<id>` from IndexedDB, so a cached copy is never shown.
3. Hide `ShareButton` until T2 replaces it (do not leave a button that copies a dead link).
4. New test file `tests/api/tenant-isolation.test.js`: for every entry in `ROUTES` whose path starts with `/drafts/:id`, call it as a second user and as nobody against the first user's draft. Send each route a valid body (and a real `postId`), because some routes check the body before the owner. Expected: second user 404, nobody 401, and the draft row is unchanged. `/tokens/:id` and `/grants/:id` are skipped: their ids are not draft ids. The test fails when `ROUTES` has a `/drafts/:id` route it does not know.
5. Update the docs and the OpenAPI text that say a draft is readable by id.
6. `scripts/smoke.mjs`: new step, a signed-out `GET /api/drafts/<id>` and `/export` expect 401.
7. Done when, before merge: the new test passes; `npm run test:api` and `npm run smoke` pass. After merge: the deployed smoke test (`smoke-deployed.yml`) for the production deployment of the merge commit passes the new step. Pull request branches are not deployed, so there is no preview check before merge.

### T2. Share links that expire
Files: `db/migrations/007_share_expiry.sql`, `server/routes/drafts.js`, `server/routes/share.js`, `server/mcp/tools.js`, `src/components/ShareButton.jsx`, `src/components/XThreadLinkButton.jsx`, `src/components/AgentLinkButton.jsx`, `src/utils/api.js`, `tests/api/share.test.js`, `tests/api/mcp-coverage.test.js`, `tests/api/tenant-isolation.test.js` (add the two new `/drafts/:id/...` routes), `scripts/smoke.mjs`, docs as in T1.
1. Migration 007 (additive, safe to run twice): `alter table share_tokens add column if not exists expires_at timestamptz`, `add column if not exists one_time boolean not null default true`.
2. `POST /api/drafts/:id/share-tokens` accepts an optional JSON body `{ "expires_in": <seconds>, "one_time": <boolean> }`. `expires_in`: integer, 60 to 604800, default `SHARE_LINK_TTL_SECONDS` from the environment or 3600. `one_time`: default `true`. Out of range: 400. An empty body means the defaults: parse JSON only when the body text is not empty (`readJson` answers 400 for an empty body, and today's buttons, tests and smoke script send none). Answer: `{ token, expires_at, one_time }`.
3. `GET /api/share/:token`: the link works only when `coalesce(expires_at, created_at + interval '1 hour') > now()`. A one-time link also needs `used = false` and is consumed in the same `UPDATE` as today. A reusable link only sets `used_at`. Otherwise 410, same page as today, with the text "This link has expired or was already used."
4. New route `DELETE /api/drafts/:id/share-tokens/:token`: owner only, deletes the row, 204. Not the owner, no row, or a `:token` that is not a uuid: 404. Also `DELETE /api/drafts/:id/share-tokens` (no token): deletes every link of that draft, 204. The owner needs this when the link text is lost.
5. MCP: `create_share_link` gets optional `expires_in` and `one_time` and returns `expires_at`. New tool `revoke_share_link { id, token? }`: without `token` it revokes every link of the draft. Add both to `META`, `REST_ROUTES` and `TRIGGERS` so the coverage and language tests pass. `REST_ROUTES.revoke_share_link` is `['DELETE /drafts/:id/share-tokens/:token', 'DELETE /drafts/:id/share-tokens']`.
6. UI: the "Share" button comes back. It opens a small menu "Link valid for: 15 minutes, 1 hour (default), 1 day, 7 days", creates a reusable link (`one_time: false`) and copies `<origin>/x-thread-preview/<token>`. Tooltip: "Link copied. It stops working in <lifetime>." The other two buttons send no body and say "works once, within 1 hour".
7. Tests: expiry (set `expires_at` in the past in the test database), reusable link read twice, one-time link read twice, out-of-range `expires_in`, revoke, revoke by another user.
8. Done when: those tests pass; smoke passes; after merge, the deployed smoke test for the merge commit passes a new `scripts/smoke.mjs` step: a link made with `expires_in: 60` returns 200, and 410 after 61 seconds.

### T3. Copy link on the consent and sign-in pages
Files: `server/oauth/consent.js`, `server/routes/oauth.js`, `tests/api/oauth.test.js`, `tests/api/mcp-clients.test.js`, `tests/e2e/screens.spec.ts`, `docs/agents/mcp.md`.
1. In `authorizeGet`, build `link = <base>/api/oauth/authorize?<the validated parameters without __path>`.
2. `consentPage` gets `link`. Under the buttons add: the text "Wrong browser? Copy this link and open it in the browser where you are signed in.", a read-only `<input>` with the escaped link, and a "Copy link" button.
2a. The consent page greets the signed-in account by its GitHub login, from the session (`session.login`, escaped). The heading becomes "Hi @<login>, allow <app> to use X Thread Draft Tool?". The copy text becomes "Hi @<login>: click Approve to continue here, or copy this link and open it in another browser." A test checks that a login with `<` is escaped. The sign-in page has no session, so it has no name.
3. The copy script is one fixed inline string. Compute its SHA-256 once at module load and add `script-src 'sha256-<hash>'` to `consentHeaders`. Nothing else in the policy changes. The script attaches the click handler with `addEventListener`; no `onclick=` attribute (a hash does not allow inline handlers). The page must still work with scripts off (the input can be selected by hand).
4. No session: instead of the redirect, answer 200 with a new `signInPage({ link, loginUrl })`: the heading "Sign in to continue", a "Continue with GitHub" link to the same `/api/auth/login?return_to=...` address as today, and the same copy-link block. It uses the same headers as the consent page without `form-action`: `no-store`, `x-frame-options: DENY`, `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-<hash>'; frame-ancestors 'none'`.
5. Tests: the policy header contains exactly one script hash and it matches the script; the link in the page equals the request address; a parameter with `"<>&` is escaped; no session gives the sign-in page with the login link; a Playwright test clicks "Copy link" and reads the clipboard.
6. Done when: tests pass; the screenshot job shows both pages at 390 px wide; Opus has checked that the policy change allows no other script.

### T3a. A sign-out button on every signed-in page, and a sign-out that really ends the session
State today (after T3b-2): every signed-in page has a sign-out button in the shared bar (`src/components/AppBar.jsx` renders `src/components/LogoutButton.jsx`). `POST /api/auth/logout` only clears the cookie. The session token itself stays valid for 30 days, so a copy of it still works. Drafts cached in the browser (IndexedDB `draft-<id>`) stay after sign-out.

Files: `db/migrations/008_revoked_sessions.sql` (use the next free number), `server/session.js`, `server/routes/auth.js`, `server/oauth/consent.js`, `server/routes/oauth.js`, `src/components/LogoutButton.jsx` (exists since T3b-2), `server/openapi.js` (the new `POST /oauth/logout` route must be in `OPENAPI.paths`), `tests/api/auth.test.js`, `tests/api/oauth.test.js`, `tests/e2e/app-bar.spec.ts`, `docs/features/`.
1. `createSession` adds a random `jti` to the token. `readSession` refuses a token without `jti` (every browser signs in once more after this ships) and a token whose `jti` is in the new table `revoked_sessions (jti text primary key, expires_at timestamptz not null)`. The check is one query by primary key. `tests/api/helpers/db.js` already uses `createSession`, so test cookies get a `jti`.
2. `POST /api/auth/logout`: read the session, insert its `jti` with the token's expiry, clear the cookie. Signed out already: still 200. Delete rows whose `expires_at` has passed in the same query.
3. `LogoutButton.jsx` (exists since T3b-2, shown by `AppBar` on the list, the editor and the settings page): after `authApi.logout()` and before loading `/`, delete every `draft-*` key from IndexedDB (`keys()` and `delMany()` from `idb-keyval`). Do not add the button to any page.
4. Consent page: next to the greeting from T3 ("Hi @<login>") add "Not you?" and a "Sign out" button. It is a second `<form method="post" action="/api/oauth/logout">` with the signed `request` value; the handler checks `decision.uid` equals the session `uid` (as `authorizePost` does), ends the session as in step 2, and answers 302 to `/api/oauth/authorize?` built only from the fields of the signed decision that are not null or empty, plus `response_type=code` and `code_challenge_method=S256`. A test checks that a request with no `state` or `scope` gives an address without them. That address now shows the sign-in page from T3. The handler reads no unsigned field (an unsigned return address would be an open redirect), and the link is not put inside the signed decision (it would make the token too long). No new script.
5. Sign-out does not disconnect AI apps or API tokens. The settings page already has that. Say so in the docs, in one sentence.
6. Tests: after logout the old cookie value gets 401 on `GET /api/drafts`; a token without `jti` is refused; the consent sign-out refuses a `request` value from another session; a Playwright test in `tests/e2e/app-bar.spec.ts` opens the list, the editor and the settings page at 390 px, clicks "Sign out" in the bar on each and lands on the login page; with the bar hidden it first clicks "Show toolbar". This Playwright test signs in with a session cookie (`context.addCookies` with a value from `createSession`), not with the bearer header the other screen tests use, because a bearer header is still signed in after logout.
7. Done when: tests pass; the deployed smoke test passes after merge; Opus has checked that the consent sign-out cannot be triggered from another site.

### T4. Summaries and outline
Files: new `server/draft-stats.js`, `server/routes/drafts.js`, `server/mcp/tools.js`, `server/openapi.js`, `server/mcp/skills.js`, `server/mcp/prompts.js`, tests `tests/api/drafts.test.js`, `tests/api/mcp.test.js`, `tests/api/mcp-contract.test.js`, `tests/api/tenant-isolation.test.js` (add `GET /drafts/:id/outline`), docs.
1. `server/draft-stats.js` exports `summarize(draft)`: `{ id, title, is_published, updated_at, published_at, version, post_count, total_chars, over_limit_count, image_count }`, and `outline(draft)`: the summary plus `posts: [{ id, index, chars, remaining, over_limit, image_count, preview }]`. `preview` is the first 40 characters. The limit is 280.
2. REST: `GET /api/drafts?view=summary` returns `{ drafts: [summary] }`. Without `view`, the answer is unchanged. New `GET /api/drafts/:id/outline` (owner only).
3. MCP: `list_drafts` gets `detail: "summary" | "full"`, default `"summary"`. New read-only tool `get_draft_outline { id }`; add it to `META`, `REST_ROUTES` (`GET /drafts/:id/outline`) and `TRIGGERS` (a tool missing from `TRIGGERS` crashes `listTools`). Update the tool descriptions: "Use get_draft_outline to count posts and characters. Use get_draft only when you need the text."
4. Update the skill and prompt text that tell the model to call `list_drafts` or `get_draft` for counting.
5. Done when: tests pass; a test proves the summary answer for a draft with 25 full posts is under 600 bytes.

### T5. Short results from post edit tools
Files: `server/mcp/tools.js`, MCP tests.
1. `add_post`, `update_post`, `remove_post`, `move_post`, `remove_image`, `add_image_from_url` return `{ draft: outline(draft), url }` instead of the full draft. `version` stays in the result, because the next edit needs it.
2. `create_draft`, `update_draft`, `create_thread_from_text`, `duplicate_draft` return the outline too. `get_draft` is the one tool that returns full text.
3. Done when: contract tests are updated and pass; Opus confirms no client contract test (M11 suite) lost an assertion.

### T6. Character counts follow the X rules
Files: new `src/utils/xLength.js`, `src/utils/threadSplitter.js`, the editor counter component, `server/draft-stats.js`, `server/routes/threads.js`, unit tests.
1. Ask Opus first: use the `twitter-text` package (`parseTweet(text).weightedLength`) or a small local function. Record the answer in #111.
2. `xLength(text)` returns the X weighted length: a URL counts 23, an emoji counts 2, Latin and Hebrew letters count 1.
3. Use it in the editor counter, in `splitIntoThreads`, in `chars` of `POST /api/threads/split` and in `draft-stats.js`.
4. Tests: Hebrew text, a long URL, an emoji with a skin tone, a 280-character Hebrew post that must not be split.
5. Done when: unit and API tests pass; the Playwright screen test shows the counter for a post with a URL.

### T7. Finish
1. `docs/agents/mcp.md`, `docs/agents/api.md`, `public/llms.txt`, `docs/features/sharing-and-export.md` describe the final behaviour.
2. `docs/plans/current.md`: move this plan to "Completed".
3. Run section 6. Write the evidence in #111, set the plan state to DONE, close #111.

## 6. Finished when

- Signed out, `GET /api/drafts/<id>` and `/export` return 401 on the preview site and on production (smoke test).
- `tests/api/tenant-isolation.test.js` is in the required unit test job and passes.
- A share link stops working after its lifetime and after a revoke (API tests and one deployed check).
- The consent page and the sign-in page have a working "Copy link" (Playwright).
- Every signed-in page has a sign-out button, and a signed-out session token is refused by the API (API test and Playwright).
- On a 390 px phone the bar is at most 56 px high on the list, the editor and the settings page, can be hidden, and the choice survives a reload (Playwright, required job).
- `list_drafts` returns summaries; `get_draft_outline` exists (MCP contract tests).
- Every task row in #111 is `merged` or `dropped`, and #111 is closed.

## 7. `AGENTS.md`

The new `AGENTS.md` is part of the T0 pull request. Read the file itself.

## 8. Starting prompt for the executor session

```
Read AGENTS.md, then docs/plans/private-drafts-share-links.md sections 1 to 4.
Read epic #111 and find the first task that is not merged. Do that task only, as section 5 says.
You are the coordinator: give the coding to a Haiku agent, the review to an Opus agent,
and every doubt to an Opus agent. Use a Sonnet agent when Haiku fails a step twice.
Open and merge pull requests without asking; each task goes to production when it is ready.
Do not ask Shaked design questions. Owner-only items go to #111 under "Needs from Shaked".
```
