# Faster MCP and REST: measure, then remove round trips and cold-start work

Written 2026-11-14 13:10 UTC. Owner report (2026-11-14): "the product feels slow through MCP (ChatGPT, Grok, Claude, Codex) and maybe through the REST API". Tracker: epic #114 (never reuse #111 or #60). For an executor that follows instructions literally.

Every fact in section 3 is marked **checked** (code read, log read, or measured, with the source) or **not checked**.

## 1. Who does what

| Role | Model | Job |
|---|---|---|
| Executor | Haiku | Does one task at a time, exactly as written in section 5. Default for every task. |
| Executor for P6 and P7 | Sonnet | These two change SQL that must stay correct under concurrent writes. Too large for Haiku. |
| Judge | Opus | Reviews every pull request against the task's "Done when" list before merge. Answers `APPROVE` or `CHANGES` with a numbered list. For P6 and P7 Opus also checks the SQL under concurrent writes (section 5, P6 step 6). |
| Adviser | Opus | Answers every doubt. The executor asks Opus, never guesses, never asks Shaked a design question. |
| Helper | Sonnet | Takes over one step when Haiku has failed the same step twice, or when a step needs code in more than three files at once. |

Start a model with the Agent tool (`model: "haiku"`, `"opus"` or `"sonnet"`). Give it the task section, the files named in it and the diff. Opus does not decide owner-only matters (money, secrets, deleting data, product behaviour not written here). Those go to the epic under "Needs from Shaked". Say in every reply which model did what.

## 2. Rules

1. Read `AGENTS.md` first, at the start of every session and after every context summary.
2. One task, one branch from the latest `main`, one pull request, one changelog file `docs/changelogs/<UTC YYYYMMDD-HHMMSS>-<slug>.md` (1 to 5 lines).
3. Procedures P-PR, P-CODEX, P-CI, P-MERGE and P-PROD are in [hardening-finish.md](./hardening-finish.md) section 5. Use them with these exceptions: "ledger" means this plan's epic; the pull request body starts `Implements docs/plans/performance.md Task <n> (P<n>)`, with the number of the task (P1 is `Task 1 (P1)`): the `Net lines` check passes a pull request whose product code grows only when the body names a plan task as `docs/plans/<file>.md Task <number>`; Codex follows `AGENTS.md`: comment `@codex review` after every push, check after 3 minutes, ask again at 10, treat it as silent at 15; reply on and resolve every Codex thread once the fix is on the head.
4. Before P-MERGE, the judge (Opus) must answer `APPROVE` for the head commit. Record the verdict as one line in the pull request description.
5. Each task ships on its own. When its pull request passes rule 4 and P-MERGE, merge it at once (merge commit, never squash) and run P-PROD: the production deployment is READY and the deployed smoke test (`smoke-deployed.yml`) for the merge commit is green. Only then start the next task. Shaked has approved opening and merging every task here.
6. After each merge, update the task row in the epic (PR number, state `merged`, production checked, and the numbers the task's "Done when" names).
7. No task changes what a user sees, except the response header `server-timing` (P1) and the field `deleted` handling in P8, both written here. If a change would alter an answer body, status or error text, stop and ask Opus.
8. Never weaken a test. The query budget test (P1) is lowered by later tasks on purpose; raising a number needs Opus `APPROVE` and a reason in the pull request. Test files under `tests/api/` start with `// @vitest-environment node`. Each test file stays inside the time budget (`npm run test:budget`).
9. No database migration in this plan (decision D3). If a task seems to need one, stop and ask Opus. The next free migration number is taken by T2 (`007`) and T3a (`008`) of the share-links plan.
10. Never fetch the production site from an agent tool. Deployed checks run in GitHub Actions (`smoke-deployed.yml`, also by `workflow_dispatch`) or with Vercel's fetch tool on `https://x-thread-draft-tool-preview.vercel.app`. Reading Vercel runtime logs with the Vercel MCP tool `get_runtime_logs` is allowed (it reads logs, it fetches no page).
11. All checks in sections 5 and 6 run without a person.

## 3. State with evidence (main at `455d578`, checked 2026-11-14 13:00 UTC)

### 3.1 Where the time can go

| # | Fact | Evidence |
|---|---|---|
| S1 | Vercel functions run in `iad1` (Washington). Neon runs in `aws-us-east-1`. Same region. | **checked**: Vercel `get_deployment` of production `dpl_9PYXEmb1KbAMHecEWTxgsYVr3mrL` → `regions: ["iad1"]`; Neon `describe_project` → `region_id: aws-us-east-1`. `vercel.json` sets no region. |
| S2 | One runtime log line of `GET /api/drafts` says `region=fra1`, another (`POST /api/oauth/token`) says `iad1`. Probably the edge region where the request entered (Shaked's browser is in Europe), not where the function ran. | **not checked** what the field means. P1 logs `VERCEL_REGION` from inside the function to settle it. If a function ever runs outside `iad1`, every SQL round trip costs about 90 ms instead of about 1 ms. |
| S3 | Neon is on the free plan (`subscription_type: free_v3`), compute fixed at 0.25 CU, scale to zero after the default 5 minutes (`suspend_timeout_seconds: 0` = default). The compute was active 54 420 s of the first 7 days (about 9 %). It last started at 12:49:45 UTC, the same second as a production `POST /api/oauth/token` request. So the first request after 5 quiet minutes waits for the compute to start. | **checked**: Neon `describe_project`, `list_branch_computes` (`started_at 2026-11-14T12:49:45Z`), Vercel runtime log at `12:49:45.287Z`. **not checked**: how long a start takes (P1 measures it as the `conn` time). |
| S4 | The DB client is `pg.Pool` over TCP, `max: 1`, no `idleTimeoutMillis` set, so pg's default 10 000 ms applies: a connection idle for 10 s is closed and the next query opens a new one (TCP, TLS, Postgres startup, SCRAM). An AI client usually thinks longer than 10 s between tool calls, so most MCP calls may open a new connection. | **checked**: `server/db.js`; `node_modules/pg-pool/index.js` line 99 (`idleTimeoutMillis = 10000`), pg 8.23.1. **not checked**: how often it happens in production and what it costs (P1). |
| S5 | No `attachDatabasePool` (Vercel's helper that closes idle pool clients cleanly before an instance suspends, recommended for Fluid compute). | **checked**: code; Vercel docs (`vercel.com/docs/functions/functions-api-reference/vercel-functions-package`). **not checked**: whether Fluid compute is on for this project (it is the default for projects created after 2025-04-23; this one was created 2026-01). |
| S6 | Two cold starts in 50 minutes are visible: the pg SSL warning is printed once per new process (`node:7` at 12:49:45, `node:8` at 12:53:50). | **checked**: Vercel `get_runtime_logs`, production, 12:09 to 12:59 UTC. Hobby keeps 1 hour of logs. |
| S7 | Every route is one function (`api/handler.js` → `server/router.js`), and it imports everything at start. Importing `api/handler.js` takes 210 to 267 ms on this machine; `@vercel/blob` alone is 153 to 177 ms of that (it also loads `undici`, 99 ms alone); `pg` 38 ms, `jose` 49 ms. Only the three image routes and `remote-image.js` need Blob and undici. | **checked**: `node -e "import('./api/handler.js')"` three runs; per-package imports. **not checked**: the same numbers on Vercel's CPU. |
| S8 | Data is tiny: 22 drafts, 5 users with drafts, at most 17 drafts per user, `posts` average 2 440 bytes and at most 7 435 bytes; `drafts` table 176 kB; 18 `oauth_tokens`, 13 `mcp_rate_limits`, 11 `share_tokens`, 1 `api_tokens`. The list query runs in 0.088 ms (`EXPLAIN ANALYZE`, seq scan + sort). Indexes are not the cause of slowness today. | **checked**: Neon `run_sql` (one `select count(*)`), `inspect_database table-sizes`, `explain_sql_statement` (read-only `select`). |
| S9 | `pg_stat_statements` is not installed, so Neon slow-query tools return nothing. | **checked**: `list_slow_queries` error. Installing it is a database change: not done, not needed for this plan (P1 measures from the app). |
| S10 | Vercel observability metrics (function duration) need Observability Plus (Pro plan). | **checked**: `create_observability_query` → 402. So P1 builds its own timing. |
| S11 | Response compression of function answers. | **not checked**. P1 step 5 prints `content-encoding` of `GET /api/drafts` in the deployed smoke test. |

### 3.2 SQL round trips per request today

Measured with a scratch script that runs the real router on PGlite and counts every statement (BEGIN and COMMIT count: each is one round trip on `pg`). 30 drafts of 10 posts of 250 characters. **checked** (script `count-queries.mjs`, kept in the session scratchpad, not in the repo; P1 turns it into a test).

| Request | Round trips | Statements | Answer bytes |
|---|---|---|---|
| MCP `initialize` | 1 | `resolveAccess` | 825 |
| MCP `notifications/initialized` | 1 | `resolveAccess` (auth runs before the notification check) | 0 |
| MCP `tools/list` | 1 | `resolveAccess` | 11 491 |
| MCP `list_drafts` (default limit 100) | 3 | auth, rate upsert, list | 202 838 |
| MCP `get_draft` | 3 | auth, rate, select | 7 182 |
| MCP `add_post`, `move_post`, `remove_post` (no image) | 7 | auth, rate, GET select, BEGIN, select for update, update, COMMIT | about 7 000 |
| MCP `update_post` | 6 | auth, rate, BEGIN, select for update, update, COMMIT | 6 892 |
| MCP `remove_post` (post with 1 own image) | 9 | the 7 above + `stillReferenced`: 2 list queries of up to 200 full drafts (98 kB each here) | 5 486 |
| MCP `whoami` | 3 | auth, rate, users | 149 |
| REST `GET /api/drafts`, `xt_` token | 3 | token select, `last_used_at` update (sent every time, writes at most every 5 min), list | 98 301 |
| REST `GET /api/drafts`, session cookie | 1 | list (T3a of the share-links plan adds 1: the revoked-session lookup) | 98 301 |
| REST `GET /api/drafts/:id`, cookie | 1 | select | 2 549 |

Facts behind the table (**checked**, code):
- In-process REST calls from MCP tools (`server/mcp/tools.js`, `restAs`) authenticate through `runAs`, so they add no auth query.
- The rate limit is one upsert per `tools/call` (`server/mcp/rate.js`), separate from the auth query.
- `editPosts` reads the draft with `GET /drafts/:id`, then `PATCH /drafts/:id` locks and reads it again in a 4-statement transaction.
- `stillReferenced` lists the caller's drafts twice with `limit=200` and full `posts` to find one URL. `deletableImageUrls` (delete and publish) reads `posts` of every other draft of the user.
- The MCP `list_drafts` answer is about twice the REST answer, because the result carries the JSON both as text and as `structuredContent` (the MCP spec asks for both).
- Warm, same region, one round trip is about 1 ms (**not checked** in production; P1 measures). So round trips matter most when a function runs far from the database (S2) and add up on write tools; the larger costs are likely S3 (Neon start), S4 (new connection) and S7 (cold start). P1 decides with numbers.
- For the AI client, the largest delay is probably reading big tool results (202 kB for 30 drafts). That is T4 (summaries) and T5 (short results) of [private-drafts-share-links.md](./private-drafts-share-links.md). This plan does not repeat them (decision D5).

### 3.3 Query patterns and indexes (**checked**: every migration and every `query(` in `server/`)

| Table | Real WHERE / ORDER BY | Index that serves it | Missing? |
|---|---|---|---|
| `drafts` | `user_id = ? and is_published = ? order by updated_at / published_at desc limit ?`; `id = ? and user_id = ?`; `user_id = ? and id <> ?` (all posts) | PK `id`; `drafts_user_published_idx (user_id, is_published)` | `(user_id, is_published, updated_at desc)` would avoid the sort. Not needed at 22 rows (D3). |
| `api_tokens` | `token_hash = ?`; `user_id = ?` | unique `token_hash`; `api_tokens_user_id_idx` | none |
| `oauth_tokens` | `token_hash = ?`; cleanup `expires_at < now() - 1 day limit 100` (on every token issue and refresh); `grant_id` | PK `token_hash`; `oauth_tokens_grant_idx` | `expires_at` for the cleanup. Seq scan of 18 rows today (D3). |
| `oauth_grants` | PK; `user_id = ?`; `(user_id, client_id, resource)`; `client_id` in client cleanup and FK cascade | PK, unique, `oauth_grants_user_idx` | `client_id` (FK without index). 4 rows (D3). |
| `oauth_codes` | `code_hash = ?`; `grant_id = ?` delete | PK | `grant_id` (FK without index). Tiny (D3). |
| `mcp_rate_limits` | upsert by `(user_id, minute)`; cleanup `minute < now() - 1 day` | PK `(user_id, minute)` | `minute` for the cleanup. 13 rows (D3). |
| `share_tokens` | `token = ?`; `draft_id` | PK, `share_tokens_draft_id_idx` | `created_by` (FK, cascade only). T2 adds `expires_at`; its lookup is by PK, so no index is needed. |
| `users` | `id = ?`; upsert by `github_id` | PK, unique `github_id` | none |

No index is redundant. Every migration runs inside `begin ... commit` (`scripts/migrate.mjs`), so `create index concurrently` cannot run there (Postgres refuses it inside a transaction). A future index uses plain `create index if not exists`; on tables this small it locks writes for milliseconds. The migration lint (`.github/workflows/tests.yml` and `tests/api/oauth-migration.test.js`) refuses `drop table|schema|database|column|role|policy`, `truncate`, `alter table ... drop`, `delete from`, and `oauth-migration.test.js` pins the exact list of migration files.

## 4. Decisions

| # | Decision | By |
|---|---|---|
| D1 | Measure first. P1 adds timing and query counts with no behaviour change, so every later gain is a number. | Agent |
| D2 | The query budget test (P1) holds the round trips of each flow in section 3.2. Each later task lowers its numbers in the same pull request. | Agent |
| D3 | No new index now. Tables are tiny and the list query runs in 0.088 ms. Revisit when `drafts` has more than 10 000 rows or P1's `db` time p95 for one statement is above 20 ms. Then add one migration with the four indexes in 3.3, plain `create index if not exists`. | Agent |
| D4 | Keep the TCP `pg` pool and one function for all routes. Keep the database in `us-east-1` and functions in `iad1`. | Agent (see section 8) |
| D5 | Payload size of MCP results is T4 and T5 of the share-links plan. This plan only removes the hidden full-draft lists (P8). | Agent |
| D6 | No in-memory cache of who owns a token. A revoked app must stop at once. | Agent (security; changing it is owner-only) |
| D7 | Neon scale to zero stays as it is until P1 has a week of numbers. If they show a start costs more than 500 ms on more than 1 in 5 MCP calls, the question in section 7 goes to Shaked. | Agent |

## 5. Tasks

Order: P0, P1 (measure), then by expected gain: P2 and P3 (connection and cold start), P6 and P7 (writes), P4 (tool-call auth), P8 (image check), P5 (REST token), P9 (finish).

### P0. Plan on `main` and the epic
1. Copy this file to `docs/plans/performance.md`. Add a line to `docs/plans/index.md` and `docs/plans/current.md` under the current plans. Changelog `docs/changelogs/<stamp>-plan-performance.md`.
2. The epic exists: #114 (created 2026-11-14 with P1 to P9 and the decisions). Set its row P0 to `merged` after the merge.
3. Done when: merged; the epic row P0 says `merged`.

### P1. Request timing and query count (no behaviour change)
Files: new `server/perf.js`, `server/router.js`, `server/db.js`, `server/mcp/server.js`, `scripts/smoke.mjs`, new `tests/api/query-budget.test.js`, `tests/api/router.test.js` (header present), `docs/operations/ci-cd.md` (one paragraph: how to read `[perf]`).
1. `server/perf.js`: an `AsyncLocalStorage` store `{ q: 0, dbMs: 0, conn: 0, rpc: null, tool: null }`, a module flag `cold = true`, and three exports:
   - `measured(fn)` returns `async (request) => { ... }`. If a store already exists (an in-process MCP call), call `fn(request)` and return. Otherwise: `const wasCold = cold; cold = false`, start `performance.now()`, run `fn` inside a new store, then set the header `server-timing` to `total;dur=<ms>, db;dur=<dbMs>, q;desc="<q>", conn;desc="<conn>", cold;desc="<0|1>"` (wrap `headers.set` in try/catch), and `console.log('[perf] ' + JSON.stringify({ m, p, s, ms, q, db, conn, cold, region: process.env.VERCEL_REGION ?? null, rpc, tool }))`. `p` is the route path from `routePath` (no query string). Never log headers, bodies, tokens or query parameters. Round `ms` and `db` to one decimal.
   - `noteQuery(ms, fresh)`: adds 1 to `q`, `ms` to `dbMs`, 1 to `conn` when `fresh`. Does nothing outside a store.
   - `noteRpc(method, tool)`: sets `rpc` and `tool` (tool only for `tools/call`, and only a name that `hasTool` knows, else `null`).
2. `server/router.js`: rename the current `route` to `dispatch` (not exported) and `export const route = measured(dispatch)`. Nested in-process calls from `server/mcp/tools.js` pass through, so their queries count in the outer request.
3. `server/db.js`: in `query()` and in the `q` function of `transaction()`, time each statement and call `noteQuery`. For `transaction()` also count `BEGIN`, `COMMIT` and `ROLLBACK`. `fresh` is true when the pool path is used and, before the statement, `pool === null || pool.totalCount === 0` (a new connection will be opened, so this statement's time includes connecting; with Neon asleep it also includes the compute start). In the PGlite path (`impl`) `fresh` is always false.
4. `server/mcp/server.js`: after the message is parsed, call `noteRpc(message.method, message.params?.name)`.
5. `scripts/smoke.mjs`: in `call()`, measure the client time and read `server-timing`; after each step print one line `TIME <step name> client_ms=<n> server=<header or none>`. In the `GET /api/drafts` step also print `ENCODING <content-encoding or none>` and send `accept-encoding: gzip, br` (Node fetch decodes it). These lines never fail the run.
6. `tests/api/query-budget.test.js` (start with `// @vitest-environment node`): build the fixtures as `tests/api/mcp-five-requests.test.js` does (`setupTestDb`, an OAuth grant for `<APP_URL>/api/mcp`, `issuePair`), plus an `xt_` token (`createApiToken`) and a cookie (`db.cookieFor`). One draft of 10 posts, one post with an image under `drafts/<uid>/`; register a test blob key function with `setBlobImpl({ put, del, key })` as `tests/api/images.test.js` does. For each row read `q` from the `server-timing` header and assert it equals the budget below. Today's budget (from section 3.2):

   | Flow | q |
   |---|---|
   | MCP `initialize` | 1 |
   | MCP `tools/list` | 1 |
   | MCP `list_drafts` | 3 |
   | MCP `get_draft` | 3 |
   | MCP `add_post` | 7 |
   | MCP `update_post` | 6 |
   | MCP `remove_post` of the post with the image | 9 |
   | REST `GET /api/drafts?published=false` with `xt_` | 3 |
   | REST `GET /api/drafts?published=false` with cookie | 1 |
   | REST `PATCH /api/drafts/:id` with cookie and a changed title | 4 |

   Also assert: the header has `total;dur=` and `cold;desc=`; a `console.log` spy saw one `[perf]` line per outer request, and the line contains no `Bearer`, no `xt_`, no `xta_` and no `cookie`. If T3a has merged first, the cookie rows are 2 (its revoked-session lookup): use the real number and say so in the pull request.
7. Done when, before merge: the new test passes; `npm run test:api` and `npm run smoke` against the local API pass. After merge: (a) the deployed smoke test for the merge commit is green and its log shows `TIME` lines with a `server=` value; (b) Vercel `get_runtime_logs` (production, `query: "[perf]"`, `since: "30m"`) returns at least one line with `region` set. Write in the epic: the `region` value seen, the `ENCODING` line, and the `TIME` line of `GET /api/drafts`.

### P2. Keep the database connection open between requests
Files: `server/db.js`, `package.json` and `package-lock.json` (new dependency `@vercel/functions`, exact version, ask Opus which), `tests/unit/` or `tests/api/` test for the pool options, changelog.
1. In `getPool()`, add `idleTimeoutMillis: 60000` (was the pg default 10000).
2. Right after creating the pool, call `attachDatabasePool(pool)` from `@vercel/functions`. Import it at the top of `server/db.js`. In tests the pool is never created (`setQueryImpl`), so nothing changes there.
3. Export a function `poolOptions()` that returns the options object used by `getPool()`, and test that `idleTimeoutMillis` is 60000, `max` is 1, and the two timeouts are unchanged.
4. Done when, before merge: tests pass; Opus has checked the Vercel docs entry for `attachDatabasePool` against the code. After merge: the deployed smoke test is green. Then, within 30 minutes, the agent runs `smoke-deployed.yml` by `workflow_dispatch` on the production URL twice, 30 seconds apart, and reads `[perf]` lines with `get_runtime_logs`: in the second run, at most 1 request has `conn` greater than 0. Record both runs' counts in the epic (before P2, a 30-second gap gives `conn: 1` on the first request of the second run, because the 10 s idle timeout closed the connection).

### P3. Load the Blob SDK and undici only on image routes (cold start)
Files: `server/blob.js`, `server/remote-image.js`, new `tests/unit/lazy-imports.test.js`, changelog.
1. `server/blob.js`: remove `import { put, del } from '@vercel/blob'`. In the default `impl`, use `put: async (...args) => (await import('@vercel/blob')).put(...args)` and the same for `del`. `setBlobImpl` stays as it is.
2. `server/remote-image.js`: remove the top-level `import { Agent } from 'undici'`; inside the function that builds the agent, `const { Agent } = await import('undici')`. Keep every SSRF check exactly as it is; Opus checks that nothing in the address checks moved or changed.
3. `tests/unit/lazy-imports.test.js` (`// @vitest-environment node`): read every `.js` file under `server/` and assert that no top-level `import ... from '@vercel/blob'` or `from 'undici'` remains (regex on lines starting with `import`). Second test: spawn `node -e "const t=performance.now();await import('./api/handler.js');console.log(performance.now()-t)"` with `--input-type=module` and print the time (do not assert a time; timings are not stable in CI).
4. Done when: tests pass, including `tests/api/images.test.js` and `tests/api/remote-image.test.js` unchanged; the pull request states the import time before (210 to 267 ms here) and after, from the same machine. After merge: the deployed smoke test is green, including its image steps.

### P6. `PATCH /api/drafts/:id` in one statement (4 round trips → 1)
Executor: Sonnet. Files: `server/routes/drafts.js` (`updateDraft` only), `tests/api/drafts-atomic-writes.test.js`, `tests/api/query-budget.test.js`, changelog.
1. Keep the validation and `ifMatchOf` as they are. Compute `expected` for SQL: `null` when there is no If-Match or it is `*`; `-1` when the tag is weak (a weak tag never matches a write); otherwise the version number.
2. Replace the transaction with one statement:
   ```sql
   update drafts
      set title = coalesce($3, title), posts = coalesce($4::jsonb, posts),
          version = version + 1, updated_at = now()
    where id = $1 and user_id = $2
      and not (($3::text is null or title = $3::text) and ($4::jsonb is null or posts = $4::jsonb))
      and ($5::int is null or version = $5::int)
    returning <COLUMNS>
   ```
   One row: answer 200 with it and its `etag`, as today.
3. No row: run `select <COLUMNS>, (...) as same_title, (...) as same_posts from drafts where id = $1 and user_id = $2` (the same expressions as today, no `for update`). No row: 404 `Draft not found`. Same title and posts: 200 with the draft (a replay). Otherwise: `staleResponse(draft)` (412). This second statement never writes.
4. Answers, statuses, headers and texts stay exactly as today. A single `UPDATE` re-checks its `WHERE` on the newest row version, so two concurrent PATCHes with the same If-Match cannot both win.
5. Budget: `PATCH /api/drafts/:id` 4 → 1; `add_post` 7 → 4; `move_post` and `remove_post` without image 7 → 4; `remove_post` with image 9 → 6.
6. Done when: every test in `tests/api/drafts*.test.js`, `tests/api/mcp*.test.js` and `tests/api/tenant-isolation.test.js` passes with no assertion removed; the budget test has the new numbers; Opus has walked through these cases and answered `APPROVE`: no If-Match, `*`, strong match, strong mismatch, weak tag, replay with a stale tag (200 today, 200 after), not the owner (404), two concurrent writes with the same tag (only one 200). After merge: the deployed smoke test (its edit step) is green.

### P7. `PATCH /api/drafts/:id/posts/:postId` in one statement (4 round trips → 1)
Executor: Sonnet. Files: `server/routes/drafts.js` (`patchPostText` only), `tests/api/drafts-post-update.test.js`, `tests/api/query-budget.test.js`, changelog.
1. Same pattern as P6. The write:
   ```sql
   update drafts
      set posts = jsonb_set(posts, array[(
            select (e.ord - 1)::text from jsonb_array_elements(posts) with ordinality e(p, ord)
             where e.p->>'id' = $3 order by e.ord limit 1), 'text'], to_jsonb($4::text)),
          version = version + 1, updated_at = now()
    where id = $1 and user_id = $2 and not is_published
      and (select e.p->>'text' from jsonb_array_elements(posts) with ordinality e(p, ord)
            where e.p->>'id' = $3 order by e.ord limit 1) is distinct from $4
      and exists (select 1 from jsonb_array_elements(posts) e(p) where e.p->>'id' = $3)
      and ($5::int is null or version = $5::int)
    returning <COLUMNS>
   ```
2. No row: read the draft (`select <COLUMNS> ... where id = $1 and user_id = $2`) and answer in today's order: no row 404 `Draft not found`; published 409; post missing 404 `Post not found in this draft`; same text 200; else 412.
3. Budget: `update_post` 6 → 3.
4. Done when: as P6 step 6, with the cases: first of two posts with the same id is the one changed (as `findIndex` today), a post whose `text` is missing, a published draft, a stale tag. After merge: the deployed smoke test is green.

### P4. One query for MCP auth and the tool-call count
Files: `server/mcp/server.js`, `server/mcp/rate.js`, `server/oauth/tokens.js` (no change to `resolveAccess` itself), `tests/api/mcp-rate.test.js`, `tests/api/query-budget.test.js`, changelog.
1. `server/mcp/rate.js`: new export `authorizeAndCount(tokenHash, resource, count)` that runs:
   ```sql
   with a as (
     select g.id as grant_id, u.id as uid, u.github_id, u.login
       from oauth_tokens t join oauth_grants g on g.id = t.grant_id join users u on u.id = g.user_id
      where t.token_hash = $1 and t.kind = 'access' and t.expires_at > now()
        and g.revoked_at is null and g.resource = $2
   ), r as (
     insert into mcp_rate_limits (user_id, minute, calls)
     select uid, date_trunc('minute', now()), 1 from a where $3::boolean
     on conflict (user_id, minute) do update set calls = mcp_rate_limits.calls + 1
     returning calls
   )
   select a.*, (select calls from r) as calls from a
   ```
   It returns `null` or `{ uid, gh, login, via: 'oauth', grantId, withinRate }` (`withinRate` is `calls <= 120`, or `true` when not counted).
2. `handleMcp`: keep `checkOrigin` first. Then read and check the message before auth, but keep the answers in today's order: read the body (`readMessage`), run `checkProtocolVersion` and `checkRequestHeaders`, and work out `count` = it is a request (has `id`), the method is `tools/call`, `params.name` is a known tool, and `arguments` is absent or an object, and none of the checks failed. Then call `authorizeAndCount` (only for a bearer of the `xta_` shape; otherwise no caller). No caller: 401, as today, even when the body was bad. Then return the first failed check, then 202 for a notification, then dispatch.
3. In `dispatch`, `tools/call` uses `ctx.caller.withinRate` instead of calling `withinToolRate`. Remove `withinToolRate` if `knip` reports it unused, and move its test cases to the new function.
4. A request without a valid token now has its body read before the 401. The body limit (1 MB) still applies. Opus checks this is acceptable.
5. Budget: every `tools/call` loses 1 (`list_drafts` 3 → 2, `get_draft` 3 → 2, `add_post` 4 → 3, `update_post` 3 → 2, `remove_post` with image 6 → 5). `initialize` and `tools/list` stay 1.
6. Done when: `tests/api/mcp*.test.js` pass with no assertion removed, including the 121st call in one minute being refused and a call with an unknown tool not being counted; the budget test has the new numbers. After merge: the deployed smoke test is green (its MCP 401 step).

### P8. "Is this image still used?" in SQL, not by listing every draft
Files: `server/routes/drafts.js` (`deletableImageUrls`), `server/routes/images.js` (`deleteImage`), `server/mcp/tools.js` (`stillReferenced`, `editPosts`, `remove_image`, `REST_ROUTES`), `server/openapi.js`, `docs/agents/api.md`, `tests/api/images.test.js`, `tests/api/mcp.test.js`, `tests/api/mcp-coverage.test.js`, `tests/api/query-budget.test.js`, changelog.
1. New function in `server/routes/drafts.js`, exported for `images.js`: `usedImageUrls(run, uid, urls, exceptDraftId)` runs
   ```sql
   select u.url from unnest($2::text[]) as u(url)
    where exists (select 1 from drafts d where d.user_id = $1
                   and ($3::uuid is null or d.id <> $3::uuid)
                   and strpos(d.posts::text, u.url) > 0)
   ```
   and returns a `Set` of the URLs still in use. A URL that also appears as plain text in a post counts as used, so the file is kept: never deleted by mistake.
2. `deletableImageUrls`: keep the owner filter, then `owned.filter((url) => !used.has(url))` with `used` from `usedImageUrls(run, uid, owned, id)`. It no longer reads every other draft's posts.
3. `DELETE /api/images`: optional body field `if_unused: true`. With it, after the owner check: if `usedImageUrls(query, uid, [url], null)` has the URL, answer `{ ok: true, deleted: false }` and delete nothing; else delete and answer `{ ok: true, deleted: true }`. Without the field the answer is exactly as today. Document the field in `server/openapi.js` and `docs/agents/api.md`.
4. `server/mcp/tools.js`: delete `stillReferenced`. In `editPosts` and `remove_image`, for each owned URL call `ctx.rest('DELETE', '/images', { url, if_unused: true })` and read `deleted` from the answer. `remove_image` still answers `{ removed: true, deleted }`. In `REST_ROUTES`, remove `'GET /drafts'` from `remove_post` and `remove_image`.
5. Tests: an image used by a duplicate is kept (MCP `remove_post`, `remove_image`, REST `DELETE /api/drafts/:id`, publish); an unused one is deleted; another user's URL is refused (403) as today; a user with 250 drafts (above the old 200 cap) still gets a correct answer.
6. Budget: `remove_post` with image 5 → 4 (with P4 and P6 merged; otherwise 2 fewer than the number before P8), and no statement in that flow returns more than one draft's `posts`.
7. Done when: tests pass with no assertion removed; budget updated. After merge: the deployed smoke test is green, including its image steps.

### P5. One query for a hand-made `xt_` token
Files: `server/tokens.js` (`findUserByToken`), `tests/api/tokens.test.js`, `tests/api/query-budget.test.js`, changelog.
1. Replace the select and the separate update with one statement:
   ```sql
   with t as (
     select u.id, u.github_id, u.login, tk.id as token_id, tk.last_used_at
       from api_tokens tk join users u on u.id = tk.user_id
      where tk.token_hash = $1 and <activeSql('tk')>
        and tk.created_at > now() - interval '7 days'
   ), touch as (
     update api_tokens set last_used_at = now()
       from t where api_tokens.id = t.token_id
        and (t.last_used_at is null or t.last_used_at < now() - interval '5 minutes')
   )
   select id, github_id, login, token_id from t
   ```
2. The returned object is unchanged. `last_used_at` still changes at most every 5 minutes (existing test).
3. Budget: REST `GET /api/drafts` with `xt_` 3 → 2.
4. Done when: `tests/api/tokens.test.js` and `tests/api/auth.test.js` pass; budget updated. After merge: deployed smoke test green.

### P9. Finish
1. Run `smoke-deployed.yml` by `workflow_dispatch` on production three times, 2 minutes apart, and once after 6 quiet minutes (Neon asleep). Read the `[perf]` lines with `get_runtime_logs`. Write in the epic a table per flow: `total` ms, `db` ms, `q`, `conn`, `cold`, before (P1 numbers) and after.
2. If the 6-minute run shows the first request's `db` time above 500 ms, and P1's week of logs showed it on more than 1 in 5 MCP calls, put the question in section 7 in the epic under "Needs from Shaked". Otherwise write "Neon start cost: <n> ms, not worth a plan change".
3. `docs/plans/current.md`: move this plan to "Completed". Close the epic.

## 6. Finished when

- `tests/api/query-budget.test.js` is in the required test job and holds, with T4/T5 merged or not (P1 to P8 do not depend on them):

  | Flow | Before | After |
  |---|---|---|
  | MCP `list_drafts`, `get_draft` | 3 | 2 |
  | MCP `add_post`, `move_post` | 7 | 3 |
  | MCP `update_post` | 6 | 2 |
  | MCP `remove_post` with an image | 9 | 4 |
  | MCP `initialize`, `tools/list` | 1 | 1 |
  | REST `GET /api/drafts` with `xt_` | 3 | 2 |
  | REST `PATCH /api/drafts/:id` | 4 | 1 |

- No request reads more than one draft's `posts` to answer an image question (P8 test).
- `api/handler.js` imports no Blob SDK or undici at start (P3 test); import time printed in the P3 pull request is at least 100 ms lower than 210 ms on the same machine.
- Two smoke runs 30 s apart: the second has at most one request with `conn` above 0 (P2).
- The `[perf]` region is `iad1` for every function line (P1), or a follow-up task is in the epic.
- The epic has the before/after table of P9 and is closed.

Gains that depend on the other plan: the size of `list_drafts` (202 kB for 30 drafts here) and of post-edit results falls only with T4 and T5. P1's `TIME` lines show their effect; this plan does not claim it.

## 7. Question for Shaked (only if P9 step 2 says so)

1. What is decided: whether the first request after 5 quiet minutes keeps waiting for the database to wake up.
2. Options:
   - A. Keep the free Neon plan. The first request after 5 quiet minutes takes about <n> ms longer (the number from P9). Costs nothing.
   - B. Move Neon to a paid plan and turn off scale to zero. That wait goes away. It costs a monthly fee (price not checked; Neon's pricing page has it) and the compute runs all the time.
3. Recommendation: A, unless the P9 number is above 1 second. With no answer, the agent keeps A.

## 8. Risks

| Risk | What we do |
|---|---|
| P1's `server-timing` header tells any caller how many queries ran. It names no table, user or token. | Accepted. Opus checks no other data is in the header or the log line. |
| P1 adds an `AsyncLocalStorage` hop per request. | Cost is microseconds. P1's `total` shows it. |
| P2: a connection kept open 60 s may keep the Neon compute awake longer, which uses more of the free compute hours (13 782 compute seconds used in the first week, checked). | P9 compares Neon `describe_project` `compute_time_seconds` per day before and after. If it more than doubles, lower `idleTimeoutMillis` to 30000 in a follow-up. Money is owner-only: tell Shaked if the free quota is near. |
| P2: a pooled connection broken while the instance was suspended. | `attachDatabasePool` releases idle clients before suspend (Vercel docs). The pg `error` on a dead client makes the pool drop it; the 8 s connect timeout bounds the retry. |
| P4 reads the body before the 401. | The 1 MB limit stays; Opus judges. |
| P6/P7 SQL wrong under concurrent writes. | Sonnet executes; Opus walks the cases in P6 step 6; the replay and stale paths keep today's answers. |
| P8 keeps a file whose URL appears as text in a post. | Safe direction (keeps, never deletes). Written in the pull request. |
| Free Vercel plan: 1 hour of runtime logs, no duration metrics (checked). | Read `[perf]` lines within 30 minutes of each run; record the numbers in the epic. |

## 9. Options rejected (do not reopen without new numbers)

| Option | Why not |
|---|---|
| Add indexes now | 22 drafts, 176 kB table, list query 0.088 ms (checked). Trigger to revisit is in D3. |
| Move the database or the functions to another region | Already the same region: `iad1` and `aws-us-east-1` (checked). P1 confirms the function region. |
| Neon HTTP driver (`@neondatabase/serverless`) instead of `pg` | Each query becomes an HTTPS request; transactions need WebSockets; the whole db layer changes. A warm TCP pool in the same region is as fast. Revisit only if P2 still shows new connections on most calls. |
| Edge runtime | `pg` needs TCP, which the edge runtime does not offer; it would force the HTTP driver above. |
| Cache "token → user" in memory | A revoked app would keep working until the cache expires (D6). Saves about one warm round trip. |
| Redis, Edge Config or another cache layer | New service and cost for data that fits in a few kB; the queries are not slow. |
| Keep-warm ping to Neon | Keeps the compute running and uses the free compute hours; this is the same choice as option B in section 7, made without Shaked. |
| Split routes into several functions | Fewer requests per instance, so more cold starts. One function keeps one warm instance for MCP and REST. |
| Skip auth on `tools/list` or notifications | The MCP authorization rules want a token on every request; it saves one ~1 ms round trip. |
| Drop the text copy of `structuredContent` in MCP results | The MCP spec asks for both for older clients. T4/T5 make the results small instead. |
| Rate limit counted in memory | Wrong across several instances; P4 removes its round trip instead. |
| More Neon compute (more CU) | Queries take under 1 ms of CPU; the cost is waiting, not computing. Also money. |
| Install `pg_stat_statements` | A database change that is not needed: P1 measures from the app. |
