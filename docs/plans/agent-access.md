# Plan: Agent-first access (headless API, agent auth, agent testing)

Status: **Ready for execution** (Phase 5 of [vercel-migration.md](./vercel-migration.md)).
Builds on the code already in PR #21 (branch `claude/lucid-sagan-bbciuo`); extend it, do not rewrite it.
Executor: Haiku (code) + Shaked (tasks marked **[HUMAN]**, all doable from a phone)

## Goal

The product must be fully usable **without a browser** by Claude/Haiku/Codex and any other agent,
under the **same authentication and authorization** as humans:

1. Every capability of the UI is available through a documented JSON API.
2. Agents authenticate as a **GitHub user** (same identity as the web login) using an **API token**.
   No anonymous write access, no shared service account, no auth bypass in production.
3. Agents can discover the API by themselves: `/llms.txt` and `/api/openapi.json`.
4. Agents can **test** the product at three levels without asking a human to run anything:
   unit/API tests, a local headless server, and a smoke test against a deployed URL.

Authorization rules do not change: a user (human or agent acting for that user) can only list,
change, publish, delete or share **their own** drafts; `GET /api/drafts/:id` stays public by id.

## Fixed decisions (do not re-decide)

| Topic | Decision |
|---|---|
| Agent credential | Personal **API token**, format `xt_` + 32 random bytes base64url (≈46 chars). Sent as `Authorization: Bearer <token>`. |
| Storage | Only the **SHA-256 hex** of the token is stored (tokens are high-entropy, so no bcrypt). Plaintext is shown **once**. |
| Lifetime | `expires_in_days` default 90, max 365. Revocable at any time. Max 20 active tokens per user. |
| How a token is obtained | (a) Web UI page `/settings/tokens` (phone-friendly), or (b) **GitHub Device Flow** via the API (agent shows a code, human approves on github.com/login/device). Both end with the same `api_tokens` row. |
| Precedence | If an `Authorization` header is present it is the **only** credential considered; an invalid/expired/revoked token → 401 (never fall back to the cookie). |
| CSRF | The `Origin` check applies only to **cookie-authenticated** mutating requests. Bearer requests skip it (they cannot be forged cross-site). |
| Token management | Creating a token via `POST /api/tokens` requires a **cookie session** (a human). Listing and revoking accept cookie or bearer. Device flow creates tokens without a cookie because GitHub itself authenticates the human. |
| Discovery | `public/llms.txt` (served at `/llms.txt`) and `GET /api/openapi.json` (OpenAPI 3.1, hand-written in `server/openapi.js`). A test fails if the router and the OpenAPI document disagree. |
| Dev-only auth | A `POST /api/dev/token` route exists **only** inside `scripts/dev-api.mjs` (local headless server). It is never imported by `server/router.js`, and the dev server refuses to start when `process.env.VERCEL` is set. |
| MCP server | Out of scope for this phase (follow-up). |

---

## Task 5.1 — Migration `db/migrations/002_api_tokens.sql`

```sql
create table if not exists api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  token_prefix text not null,          -- first 10 chars, e.g. "xt_AbC1234", for display only
  created_via text not null default 'web', -- 'web' | 'device'
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
);
create index if not exists api_tokens_user_id_idx on api_tokens(user_id);
```
Additive only. The build-time migrator applies it.

## Task 5.2 — `server/tokens.js`

- `generateToken()` → `{ token, hash, prefix }` using `crypto.randomBytes(32).toString('base64url')`.
- `hashToken(token)` → sha256 hex.
- `createApiToken(userId, { name, expiresInDays = 90, via = 'web' })` → enforces 20-active limit
  (409 otherwise), name 1–100 chars, `1 ≤ expiresInDays ≤ 365`; returns `{ token, id, name, prefix, expires_at }`.
- `findUserByToken(token)` → `select u.id, u.github_id, u.login, t.id as token_id from api_tokens t join users u ... where t.token_hash = $1 and t.revoked_at is null and (t.expires_at is null or t.expires_at > now())`;
  then `update api_tokens set last_used_at = now() where id = $1 and (last_used_at is null or last_used_at < now() - interval '5 minutes')`.

## Task 5.3 — Auth integration (`server/session.js`, `server/router.js`)

- `requireUser(request)`:
  1. `authorization` header present → must match `^Bearer (xt_[A-Za-z0-9_-]{40,})$` and resolve via
     `findUserByToken`; else `HttpError(401, 'Invalid or expired API token')`. Returns
     `{ uid, gh, login, via: 'token', tokenId }`.
  2. Otherwise cookie session as today, plus `via: 'session'`.
- `requireSessionUser(request)` → like `requireUser` but rejects `via: 'token'` with 403
  (used only by `POST /api/tokens`).
- `server/router.js`: call `checkOrigin` only when the request has **no** `authorization` header.
  (A cross-site browser page cannot attach an `Authorization` header without a CORS preflight, and
  the API sends no CORS allow headers, so this does not weaken CSRF protection.)
- `server/router.js`: `export const ROUTES` (the existing array) so the OpenAPI parity test can read it.
- `GET /api/auth/me` also accepts bearer tokens and returns `{ user, auth: 'session' | 'token' }`.

## Task 5.4 — Token routes `server/routes/tokens.js`

| Method + path | Auth | Behaviour |
|---|---|---|
| `GET /api/tokens` | session or token | `{ tokens: [{ id, name, prefix, created_via, created_at, last_used_at, expires_at, revoked_at }] }` (never the hash) |
| `POST /api/tokens` `{ name, expires_in_days? }` | **session only** | 201 `{ token, id, name, prefix, expires_at }` — the only time the plaintext is returned |
| `DELETE /api/tokens/:id` | session or token | Sets `revoked_at = now()` where `user_id` matches; 404 otherwise |

## Task 5.5 — GitHub Device Flow `server/routes/device.js`

**[HUMAN] prerequisite:** GitHub → Settings → Developer settings → OAuth Apps → *X Thread Draft Tool*
→ tick **Enable Device Flow** → Update application.

| Method + path | Auth | Behaviour |
|---|---|---|
| `POST /api/auth/device/start` `{}` | none | Server POSTs `https://github.com/login/device/code` (`client_id`, `scope=read:user`, `accept: application/json`). Returns `{ device_code, user_code, verification_uri, interval, expires_in }`. |
| `POST /api/auth/device/poll` `{ device_code, name }` | none | Server POSTs `https://github.com/login/oauth/access_token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code`. `authorization_pending`/`slow_down` → **202** `{ status: 'pending', interval }`. `expired_token`/`access_denied` → **400** `{ error }`. Success → fetch `https://api.github.com/user`, upsert user (same SQL as the web callback; extract it into a shared `upsertGithubUser()`), `createApiToken(uid, { name, via: 'device' })` → **201** `{ token, user }`. The GitHub access token is discarded. |

No client secret is needed for device flow. Agents call `start`, show the human
"Open https://github.com/login/device and enter **ABCD-1234**", then poll every `interval` seconds.

## Task 5.6 — API parity endpoints

Add what the UI can do but the API cannot:

| Method + path | Auth | Behaviour |
|---|---|---|
| `POST /api/drafts/:id/duplicate` | owner | Same as the UI duplicate (new post ids, title `"<title> (copy)"`). 201 `{ draft }` |
| `GET /api/drafts/:id/export?format=json\|text\|formatted` | public (same as GET draft) | Uses `src/utils/exportFormats.js` (`exportAsJSON`, `exportAsPlainText`, `exportAsFormattedText`). `text/plain` or `application/json`. |
| `POST /api/threads/split` `{ text, max_chars? }` | none | Uses `src/utils/threadSplitter.js` `splitIntoThreads`. → `{ posts: [{ text, chars }] }`. Body ≤ 100 KB. |
| `POST /api/images/from-url` `{ draftId, url }` | owner of draft | Server-side fetch replacing the browser CORS path: `http(s)` only; resolve the hostname with `dns.lookup(all)` and reject loopback, private, link-local, CGNAT, multicast and IPv6 ULA/link-local addresses; `redirect: 'manual'` (a 3xx is rejected); 10 s timeout; `content-type` must start with `image/`; ≤ 4 MB streamed. Then same Blob `put` as `/api/images`. 201 `{ url, sourceUrl }`. |

Known limit: DNS rebinding between the check and the fetch is not prevented (acceptable here;
note it in a code comment). Update `src/components/ImageUpload.jsx` and `src/utils/images.js`
`uploadImageFromUrl` to use `/api/images/from-url` (removes the browser CORS failure mode).
`listDrafts` gains `?limit=` (default 100, max 200) — documented, no cursor yet.

## Task 5.7 — Discovery: `public/llms.txt` and `/api/openapi.json`

Create the `public/` directory (it does not exist yet; Vite copies it into `dist/`) and
`public/llms.txt` (llmstxt.org format). Content outline — keep it under ~150 lines:
```
# X Thread Draft Tool
> Compose and manage X/Twitter thread drafts. Fully usable by agents through a JSON API.

## Auth
- Agents use a personal API token: `Authorization: Bearer xt_...`
- Get one: web UI /settings/tokens, or device flow (POST /api/auth/device/start, then /poll)
- Tokens act as the GitHub user who created them; same permissions as that user in the UI.

## Quickstart
(curl examples: me, create draft, update posts, split text, create share link, publish, delete)

## Reference
- [OpenAPI 3.1 spec](/api/openapi.json)
- [Agent guide in repo](https://github.com/Shaked/x-thread-draft-tool/blob/main/docs/agents/api.md)

## Rules
- Draft shape: { title, posts: [{ id, text, images: [{ url }], embeddedTweet }] }
- Max 4 images per post, 4 MB per image; one-time share links work exactly once.
```
- `server/openapi.js` exports the OpenAPI object; `GET /api/openapi.json` returns it (public,
  `cache-control: public, max-age=300`). Security scheme: `bearerAuth` (http bearer) + `cookieAuth`.
- `tests/api/openapi.test.js`: every router entry (method + path, `:id` → `{id}`) exists in
  `paths`, and every `paths` operation exists in the router. Dev-only routes are excluded.
- `/llms.txt` is served as a static file (Vercel serves real files before applying rewrites; the
  smoke script verifies it). In `vite.config.js` add `/^\/llms\.txt$/` to
  `navigateFallbackDenylist` so the service worker never answers it with `index.html`.

## Task 5.8 — Web UI: `/settings/tokens`

Small page (React route `/settings/tokens`, link from the draft list header "API tokens"):
create (name + expiry select 30/90/365), show the new token once with a Copy button and a
"store it now, it won't be shown again" warning, list existing tokens (prefix, name, created via,
last used, expires), Revoke button with confirm. Must work on a phone screen.

## Task 5.9 — Local headless server `scripts/dev-api.mjs`

- `npm run dev:api` → Node `http` server on `127.0.0.1:${PORT || 8787}` that converts each Node
  request into a Web `Request`, calls `route()`, and streams the `Response` back.
- Uses **PGlite** (in-memory by default; `--data-dir .dev-db` to persist) + `applyMigrations`.
- Swaps `server/blob.js` for a filesystem implementation writing to `.dev-blob/` and serving it at
  `http://127.0.0.1:8787/dev-blob/...` (add `setBlobImpl()` to `server/blob.js`).
- Mocks GitHub only for device flow when `--fake-github` is passed (auto-approves).
- Adds dev-only `POST /api/dev/token { login }` → creates/upserts a user with a fake negative
  `github_id` and returns `{ token }`. `scripts/dev-api.mjs` answers `/api/dev/*` **itself, before**
  delegating every other request to `route()`; nothing under `server/` knows about it.
- Refuses to start if `process.env.VERCEL` is set. Sets `PUBLIC_APP_URL` and a random `SESSION_SECRET`.
- `vite.config.js` `server.proxy`: `/api` → `http://127.0.0.1:8787` so `npm run dev` + `npm run dev:api` gives a working full app locally.
- `.gitignore`: `.dev-db/`, `.dev-blob/`, `.xt-token`.

## Task 5.10 — Smoke test + agent login scripts

`scripts/smoke.mjs` (no dependencies beyond Node 20). It creates temporary drafts titled
`[smoke] <timestamp>` in the token owner's account and always deletes them:
- Env/flags: `XT_BASE_URL` (required), `XT_TOKEN` (optional — omit when a proxy injects the
  `Authorization` header), `VERCEL_AUTOMATION_BYPASS_SECRET` (optional → header `x-vercel-protection-bypass`).
- Steps, each printed as `PASS`/`FAIL <reason>`: health → `/llms.txt` is text containing
  "X Thread Draft Tool" → `/api/openapi.json` parses → `me` (auth = token) → split text →
  create draft → patch posts → get → duplicate → export text → create share token → GET
  `/api/share/<token>.md` = 200 → same again = 410 → delete both drafts (in `finally`).
- Exit 1 on any failure. Never prints the token.

`scripts/agent-login.mjs`:
- `--base <url> --name <token name>`; runs device flow: prints only
  `Open https://github.com/login/device and enter: ABCD-1234`, polls, writes the token to
  `.xt-token` (mode 600) and prints `Token saved to .xt-token (prefix xt_AbC1234…)`.

npm scripts: `dev:api`, `smoke`, `agent:login`.

## Task 5.11 — CI

- `tests.yml`: add job `smoke-local` → `npm ci`, start `npm run dev:api &`, wait for
  `/api/health`, get a token from `/api/dev/token`, run `npm run smoke` against `http://127.0.0.1:8787`.
- New `.github/workflows/smoke-deployed.yml`:
  - `on: deployment_status` with `if: github.event.deployment_status.state == 'success'`, base URL =
    `github.event.deployment_status.environment_url`; plus `workflow_dispatch` with input `base_url`.
  - Secrets: `XT_SMOKE_TOKEN` (token of the owner's account), `VERCEL_AUTOMATION_BYPASS_SECRET` (optional).
  - Skips with a notice (not a failure) if `XT_SMOKE_TOKEN` is not set.

## Task 5.12 — Tests (`tests/api/`)

Minimum cases: token create (session only; bearer → 403), list hides hash, revoke → subsequent
bearer 401, expired token 401, 21st token → 409; bearer request with foreign `Origin` still allowed;
cookie request with foreign `Origin` → 403; device start/poll pending/denied/success (mock `fetch`);
duplicate/export/split; from-url rejects `http://127.0.0.1`, `http://10.0.0.1`, `http://[::1]`,
redirects, non-image, > 4 MB; openapi parity. All with PGlite, no network.

## Task 5.13 — Docs

- `docs/agents/api.md`: full agent guide (auth options, curl for every endpoint, error format,
  limits, how to test at each level, how Claude cloud sessions get access — copy the "Agent access
  in Claude Code cloud" section below).
- `AGENTS.md` / `claude.md`: add a short "Using the product as an agent" section linking to it.
- README: "API & agents" section. New changelog file. `npm run docs:refresh`.

---

## How agents test — summary for every agent

| Level | Command | Needs network? | Needs secrets? |
|---|---|---|---|
| 1. Unit + API | `npm ci && npm run test:unit` | npm registry only | no |
| 2. Local headless | `npm run dev:api` then `XT_BASE_URL=http://127.0.0.1:8787 XT_TOKEN=$(curl -s -XPOST localhost:8787/api/dev/token -d '{"login":"agent"}' -H 'content-type: application/json' \| jq -r .token) npm run smoke` | no | no |
| 3. Deployed | `XT_BASE_URL=https://x-thread-draft-tool-preview.vercel.app npm run smoke` | the app host | API token (see below) |

Levels 1 and 2 must always be run by the executor before pushing; never ask a human to run them.
(Verified 2026-11-07: level 1 runs in a Claude Code cloud sandbox — 97/97 tests pass.)

## Agent access in Claude Code cloud **[HUMAN, one-time, phone]**

1. **Vercel preview protection:** Vercel → project → Settings → **Deployment Protection** →
   set **Vercel Authentication** to *Disabled* (the app has its own GitHub auth; drafts are already
   public by id). Alternative if you want to keep it: enable **Protection Bypass for Automation**
   and store the secret as GitHub secret `VERCEL_AUTOMATION_BYPASS_SECRET`.
2. **Enable Device Flow** on the GitHub OAuth app (Task 5.5 prerequisite).
3. **Create a token for agents** once the feature is deployed: open
   `https://x-thread-draft-tool-preview.vercel.app/settings/tokens` (or production after cutover),
   create "agents", copy it.
4. **GitHub Actions:** add secret `XT_SMOKE_TOKEN` = that token.
5. **Claude cloud sessions:** when an agent needs level-3 access it calls the environment's
   credential request for host `x-thread-draft-tool-preview.vercel.app` (and/or
   `x-thread-draft-tool.vercel.app`), type bearer; paste the token in the secure form. The proxy
   injects `Authorization: Bearer …` for that host, the agent never sees the token, and
   `npm run smoke` is run **without** `XT_TOKEN`. If the host is blocked by the network policy,
   the agent proposes adding exactly those hosts to the environment.

**Network reality (verified 2026-11-07):** Claude Code cloud sessions cannot reach `*.vercel.app`
by default — the session proxy refuses the connection. An agent that needs level 3 must first propose
an environment network change for exactly `x-thread-draft-tool-preview.vercel.app` and
`x-thread-draft-tool.vercel.app` (wildcards are not allowed, so per-deployment URLs such as
`x-thread-draft-tool-<hash>-….vercel.app` stay unreachable from cloud sessions — always use the two
stable domains). GitHub Actions has no such restriction, so `smoke-deployed.yml` can use per-deployment URLs.

**Databases behind previews:** the Neon integration gives Preview deployments their own database
branch copied from production. Until the data migration runs, production is empty, so the preview
starts with no users: sign in on the preview domain first, then create the token there. After
cutover, create the agents' token on production; previews branched later contain it.
If a new preview answers 401 to a token that worked before, the integration made a fresh branch for
that deployment — create a new token on that preview (web page or `npm run agent:login`).

## Executor order of work (what to do, start to finish)

1. `git pull --rebase origin claude/lucid-sagan-bbciuo`; `npm ci`; `npm run test:unit` must pass before you change anything.
2. Tasks 5.1 → 5.13 in order, one commit each. After each: `npm run build && npm run test:unit`.
   From Task 5.10 on, also run level 2 (local headless smoke) before pushing.
3. Update the "Execution status" table in `vercel-migration.md` (Phase 5 → done).
4. Walk both validation checklists (`vercel-migration.md` and below); fix anything unchecked.
5. Push, then update **PR #21's** description: summary, test results (levels 1 and 2 output
   summary), and a "Human steps" list (Phase 5 [HUMAN] items, then Task 3.3 and Phase 4).
6. Stop. Do not merge, do not run the data migration. Level 3 runs only after Shaked finishes the
   human steps; if asked later, propose the network change and request the credential as described above.

## Validation checklist (reviewer)

- [x] No route accepts writes without `requireUser`; bearer and cookie paths share the same owner checks. (Intentional exceptions: `device/start`, `device/poll`, `auth/logout`, `threads/split`, and the share GET, which consumes by token.)
- [x] Token plaintext never stored or logged; only hash + prefix in DB; list endpoint omits hash.
- [x] Invalid bearer never falls back to cookie.
- [x] Origin check skipped only when an `authorization` header is present.
- [x] `/api/dev/token` is unreachable from `api/handler.js` (grep: not imported by `server/`).
- [x] SSRF guard covers DNS-resolved private ranges and refuses redirects.
- [ ] `/llms.txt` and `/api/openapi.json` served on preview. *Not yet: verified locally (dev server serves both; smoke 16/16); the preview check happens after this PR's deployment. The openapi parity test passes.*
- [x] `npm run test:unit`, `npm run build` pass. The `smoke-local` job runs the same level-2 smoke that passes locally; its CI result appears on PR #21.
- [x] `vercel-migration.md` execution status table updated; PR #21 description lists the human steps.
