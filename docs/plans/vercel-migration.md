# Plan: Migrate off Supabase to Vercel + Neon + Vercel Blob

Status: **Phases 1–2, Tasks 3.1–3.2 and Phase 5 (agent access) done in PR #21. Next: the human
steps listed in the PR description (Task 3.3 and Phase 4).**
Executor: Haiku (code tasks) + Shaked (tasks marked **[HUMAN]**, all doable from a phone)
Validator: Claude Opus (see "Validation checklist" at the end)

## Goal

Remove every Supabase dependency (Auth, Postgres, Storage, Edge Function) and run the
whole product on Vercel for **$0/month**:

| Concern | Today (Supabase) | After |
|---|---|---|
| Frontend | Vercel Hobby (static SPA) | unchanged |
| API | Supabase client in browser + RLS | Vercel Functions in `/api` (Node runtime) |
| Auth | Supabase GitHub OAuth | GitHub OAuth App + signed session cookie (JWT, `jose`) |
| Authorization | RLS `auth.uid() = user_id` | `WHERE user_id = $session.uid` in every write query |
| Database | Supabase Postgres | Neon Postgres (Vercel Marketplace, Free plan) via `pg` |
| Images | Supabase Storage bucket `draft-images` | Vercel Blob (public, random-suffixed URLs) |
| One-time share links | Edge Function `share` | `/api/share/:token` in the same API function |
| Keep-alive cron | `keep-supabase-alive.yml` | deleted (Neon free does not pause projects) |

Behaviour must stay identical for users: same routes, same draft JSON shape, same
offline/IndexedDB behaviour, same "anyone with the link can view, only the owner can edit".

## Non-goals

- No UI redesign. No new features. No TypeScript conversion of the app.
- Do not touch `src/utils/threadSplitter.js`, `exportFormats.js`, `rtlDetector.js`, `localStorage.js`.
- Do not change the post object shape (`{ id, text, images, embeddedTweet }`).

## Amendments after Phase 0 (these override anything below)

Phase 0 is **complete** (2026-11-07). Findings and resulting changes:

1. **Supabase schema confirmed** (backup run 42383061789): `drafts` has exactly
   `id, user_id, title, posts, is_published, published_at, created_at, updated_at`.
   `is_published` is **nullable** in Supabase → the importer must use
   `coalesce(is_published, false)`. Counts: 7 users, 17 drafts, 23 share tokens, 108 storage objects
   (most are orphans; only images referenced in `posts` are migrated).
2. **Neon env vars** use prefix `DATABASE`: the app uses only `DATABASE_URL` (pooled) and
   `DATABASE_URL_UNPOOLED` (direct). Ignore the other `DATABASE_*` vars Neon created.
3. **Each Preview deployment gets its own Neon branch** (integration setting). Therefore migrations
   run **at build time** on Vercel, not from a GitHub workflow:
   - `vercel.json` `buildCommand` becomes
     `node scripts/migrate.mjs && VITE_DEPLOYED_AT=... (existing command unchanged)`.
   - `scripts/migrate.mjs` uses `DATABASE_URL_UNPOOLED`; if it is missing it prints a warning and
     exits 0 (so `npm run build` in CI and locally still works). On Vercel it is always set.
   - **Do not create** `.github/workflows/db-migrate.yml` (Task 2.6). Instead add the destructive-SQL
     lint over `db/migrations/*.sql` as a step in the `unit` job of `.github/workflows/tests.yml`.
4. **One GitHub OAuth App** serves both environments (two redirect URIs registered). Vercel env:
   `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` (Production + Preview, same values);
   `SESSION_SECRET` and `PUBLIC_APP_URL` differ per environment:
   - Production: `https://x-thread-draft-tool.vercel.app`
   - Preview: `https://x-thread-draft-tool-preview.vercel.app` (custom domain bound to branch
     `claude/lucid-sagan-bbciuo`). Preview sign-in works only on this domain.
5. **Blob store** `x-thread-images` is **public**; env var `BLOB_READ_WRITE_TOKEN`.
6. **GitHub Actions secrets available**: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`,
   `SUPABASE_DB_PASSWORD`, `SUPABASE_URL`, `DATABASE_URL_UNPOOLED` (production Neon),
   `BLOB_READ_WRITE_TOKEN`. `data-migrate.yml` (Task 3.2) uses these; no `SUPABASE_DB_URL` secret
   exists, resolve it with `scripts/supabase-db-url.sh`.
7. **Do not delete** `.github/workflows/supabase-backup.yml` or `scripts/supabase-db-url.sh` in
   Task 2.6 (kept until Supabase is deleted). Do delete `keep-supabase-alive.yml` and `supabase-deploy.yml`.
8. **Phase 5 — agent-first access** is specified in [agent-access.md](./agent-access.md) and is part
   of the same PR: API tokens, GitHub device flow, `/llms.txt`, `/api/openapi.json`, API parity
   endpoints, local headless server, smoke tests. Unit/API tests run in cloud sandboxes without
   secrets — always run them yourself; never ask a human to.
9. **Executor deliverable**: work on branch `claude/lucid-sagan-bbciuo`, push, and keep **PR #21**
   (`feat: migrate from Supabase to Vercel + Neon + Blob`) as the single PR — update its description,
   do not open another. Do not merge it. Do not run the data migration.

## Execution status (keep this table current; update it in the same commit as the work)

| Item | Owner | Status |
|---|---|---|
| Phase 0 — backup, Neon, Blob, OAuth app, env vars, secrets | Shaked | done |
| Phase 1 — backend (Tasks 1.1–1.11) | executor | done |
| Phase 2 — frontend + Supabase removal + docs (Tasks 2.1–2.7) | executor | done |
| Tasks 3.1–3.2 — data migration script + workflow | executor | done |
| Phase 5 — agent-first access (agent-access.md Tasks 5.1–5.13) | executor | done (PR #21) |
| Final executor pass — both validation checklists, PR #21 description | executor | done (PR #21) |
| Phase 5 human steps (Device Flow, Deployment Protection, token, secrets) | Shaked | done (verified: deployed smoke test 16/16 on the stable preview domain, run 42394993721) |
| Phase 4 step 1 — preview testing (human + agent smoke) | Shaked + agents | agent smoke done (16/16). Human UI checks pending: uploads, publish, share links, private tab, airplane-mode edit |
| Merge PR #21, then Task 3.3 immediately, then Phase 4 steps 2–4 | Shaked | last |

## Fixed decisions (do not re-decide)

1. **One serverless function only**: `api/handler.js`. All `/api/*` paths are rewritten to it
   (`vercel.json`) and dispatched by a tiny in-process router. Reason: Hobby limits the number
   of functions per deployment; one function avoids the limit and keeps cold starts shared.
2. **Handler style**: Web-standard named exports in the Node.js runtime:
   `export async function GET(request) { ... }` (same for `POST`, `PATCH`, `DELETE`).
   Each returns a `Response`. No Express, no Next.js.
3. **DB driver**: `pg` (node-postgres) using Neon's **pooled** connection string
   (`DATABASE_URL`). Pool `max: 1`, created lazily once per function instance.
4. **Tests use PGlite** (`@electric-sql/pglite`, in-process Postgres) through the same
   `query()` interface. No Docker/Postgres needed locally or in CI.
5. **Plain JS (ESM)** everywhere in `api/` and `server/`. `render.ts` is converted to JS.
6. **Auth**: anyone with a GitHub account can sign in (no allowlist). OAuth scope `read:user`.
7. **Users keep their Supabase UUID** so existing `drafts.user_id` values stay valid. New users
   get `gen_random_uuid()`. Users are matched on `github_id` at login.
8. **Images**: uploaded through our API with `@vercel/blob` `put()` (server-side). Max
   **4 MB** per image after client compression (Vercel request body limit is 4.5 MB).
9. **Share links**: X-thread link stays `/x-thread-preview/:token` (SPA page). Agent link
   becomes `${origin}/api/share/${token}.md`.

## Environment variables

| Name | Where | Value |
|---|---|---|
| `DATABASE_URL` | Vercel (all envs, set by Neon integration) | Neon pooled connection string |
| `DATABASE_URL_UNPOOLED` | Vercel + GitHub Actions secret | Neon direct connection string (migrations) |
| `BLOB_READ_WRITE_TOKEN` | Vercel (set by Blob integration) | Blob store token |
| `GITHUB_CLIENT_ID` | Vercel (Production; Preview uses preview OAuth app) | OAuth App client id |
| `GITHUB_CLIENT_SECRET` | Vercel | OAuth App client secret |
| `SESSION_SECRET` | Vercel | 32+ random bytes, base64: `openssl rand -base64 48` |
| `PUBLIC_APP_URL` | Vercel | e.g. `https://x-thread-draft-tool.vercel.app` (no trailing slash) |

Removed: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, all `SUPABASE_*` GitHub secrets (after cutover).

---

## Phase 0 — Environment preparation **[HUMAN, phone only]**

Everything here is done in a phone browser (GitHub, Vercel, Neon and Supabase dashboards) or the
GitHub app. Haiku starts **only after** Phase 0 is complete. Keep every secret in 1Password and
never paste secrets into a Claude chat. If a GitHub settings menu is hidden on mobile, switch the
browser to "Desktop site".

0.1 **Merge the plan PR** (it contains this plan and `supabase-backup.yml`). Workflows can only be
    started manually once they are on `main`.
0.2 **Supabase awake:** Supabase dashboard → project. If paused, tap **Restore** and wait.
0.3 **Supabase secrets:** nothing to create. The repo already has `SUPABASE_ACCESS_TOKEN`,
    `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD` and `SUPABASE_URL`; the workflows use
    `scripts/supabase-db-url.sh` to look up the Session pooler (IPv4) connection string from them.
    If the backup fails with a password error, reset the DB password in Supabase → Database
    settings and update `SUPABASE_DB_PASSWORD`.
0.4 **Backup passphrase:** 1Password → new 64-char password → save as "xt backup passphrase".
0.5 **GitHub secret** (repo → Settings → Secrets and variables → Actions): add `BACKUP_PASSPHRASE`.
0.6 **Run the backup:** GitHub app → repo → Actions → **Supabase backup (pre-migration)** →
    Run workflow on `main`. When it is green, the run summary shows the `drafts` columns and row
    counts, and an encrypted `supabase-backup` artifact (kept 90 days) is attached.
    The same output is printed in the log of the "Write summary" step (readable in the GitHub
    app). Haiku reads the `drafts` columns from there for Task 1.2.
0.7 **Neon + Blob:** Vercel → project → **Storage** → Create **Neon** (Free) → connect to
    Production, Preview and Development. Then Create **Blob** → connect. Check that Settings →
    Environment Variables lists `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `BLOB_READ_WRITE_TOKEN`.
0.8 **Preview DB branch:** Neon console → Branches → create `preview` → copy its pooled and
    direct strings into Vercel env vars `DATABASE_URL` / `DATABASE_URL_UNPOOLED` for **Preview**
    only. Skip this if the integration already creates per-preview branches.
0.9 **URLs:** Vercel → Deployments → note the production domain (= `PUBLIC_APP_URL`) and the
    branch alias for `claude/lucid-sagan-bbciuo` (`...-git-claude-lucid-sagan-bbciuo-....vercel.app`).
0.10 **GitHub OAuth apps** (github.com → Settings → Developer settings → OAuth Apps → New):
    - Production: Homepage `PUBLIC_APP_URL`, callback `PUBLIC_APP_URL/api/auth/callback`.
    - Preview: Homepage = branch alias, callback `<branch alias>/api/auth/callback`.
    Generate a client secret for each and store the IDs and secrets in 1Password.
0.11 **Session secrets:** 1Password → two new 64-char passwords ("xt session prod", "xt session preview").
0.12 **Vercel env vars** (Settings → Environment Variables):
    - Production: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` (production app), `SESSION_SECRET`
      (prod), `PUBLIC_APP_URL` (production domain, no trailing slash).
    - Preview: the same names with the preview app values, the preview session secret, and the
      branch alias URL.
0.13 **GitHub secrets for the migration workflows:** `DATABASE_URL_UNPOOLED` (production Neon
    direct string, Neon console → Connect) and `BLOB_READ_WRITE_TOKEN` (Vercel → Storage → your
    Blob store → `.env.local` tab).
0.14 **Start Haiku:** Claude app → Code → new session on `Shaked/x-thread-draft-tool`, model
    Haiku, prompt:
    > Execute `docs/plans/vercel-migration.md` Phases 1, 2 and Tasks 3.1–3.2 on branch
    > `claude/lucid-sagan-bbciuo`. Skip tasks marked [HUMAN]. Read the `drafts` columns from the
    > latest successful "Supabase backup (pre-migration)" run summary. Commit per task, push, and
    > open a PR when done.

---

## Phase 1 — Backend (Haiku)

Work on branch `claude/lucid-sagan-bbciuo` (or the branch you were assigned). One commit per task,
conventional commit messages (`feat:`, `test:`, `chore:`, `docs:`).

### Task 1.1 — Dependencies and test config

```bash
npm install pg jose @vercel/blob
npm install -D @electric-sql/pglite
```
- Add npm scripts:
  - `"db:migrate": "node scripts/migrate.mjs"`
  - `"test:api": "vitest run tests/api"`
- In `vitest.config.js`, change `include` to
  `['tests/unit/**/*.{test,spec}.{js,jsx,ts,tsx}', 'tests/api/**/*.test.js']`.
  Every file in `tests/api/` must start with the line `// @vitest-environment node`.
- Done when `npm run test:unit` still passes.

### Task 1.2 — Schema and migrator

Create `db/migrations/001_init.sql` (idempotent, additive only):
```sql
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  github_id bigint not null unique,
  login text not null,
  name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null default '',
  posts jsonb not null default '[]'::jsonb,
  is_published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists drafts_user_published_idx on drafts(user_id, is_published);

create table if not exists share_tokens (
  token uuid primary key default gen_random_uuid(),
  draft_id uuid not null references drafts(id) on delete cascade,
  created_by uuid not null references users(id) on delete cascade,
  used boolean not null default false,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists share_tokens_draft_id_idx on share_tokens(draft_id);
```
(Add any extra `drafts` columns shown in the Phase 0.5 backup run summary.)

Create `scripts/migrate.mjs`:
- Reads `DATABASE_URL_UNPOOLED` (fallback `DATABASE_URL`); exits 1 with a clear message if missing.
- Creates `schema_migrations(name text primary key, applied_at timestamptz default now())`.
- Applies every `db/migrations/*.sql` in filename order that is not yet recorded, each inside
  `BEGIN/COMMIT`, then inserts its name. Prints applied/skipped names.
- Exports `applyMigrations(queryFn)` so tests can run it against PGlite. The CLI part runs only
  when executed directly (`import.meta.url === pathToFileURL(process.argv[1]).href`).

### Task 1.3 — `server/db.js`

```js
// query(text, params) -> { rows }
export async function query(text, params = []) { ... }   // uses lazy pg.Pool({ connectionString: DATABASE_URL, max: 1 })
export function setQueryImpl(fn) { ... }                 // tests only: replace implementation
```
Test helper `tests/api/helpers/db.js`: creates a fresh `PGlite()`, runs `applyMigrations`,
calls `setQueryImpl((t, p) => pg.query(t, p))`, and returns helpers to insert a user/draft.

### Task 1.4 — `server/http.js`

Small helpers, no framework:
- `json(data, status = 200, headers = {})` → `Response` with `content-type: application/json`.
- `error(status, message)` → `json({ error: message }, status)`.
- `parseCookies(request)` → object.
- `cookie(name, value, { maxAge, httpOnly = true, secure = true, sameSite = 'Lax', path = '/' })` → string.
- `readJson(request, maxBytes = 1_000_000)` → parsed body; throws `HttpError(413)` if larger,
  `HttpError(400)` if invalid JSON.
- `class HttpError extends Error { constructor(status, message) }`.

### Task 1.5 — `server/session.js`

- `createSession(user)` → JWT HS256 via `jose` `SignJWT`, payload `{ uid, gh, login }`,
  expiry 30 days, secret `SESSION_SECRET`.
- `readSession(request)` → payload or `null` (cookie name `xt_session`; invalid/expired → `null`).
- `sessionCookie(token)` / `clearSessionCookie()` → Set-Cookie strings (`maxAge` 30d / 0).
- `requireUser(request)` → payload or throws `HttpError(401, 'Not authenticated')`.

### Task 1.6 — `server/routes/auth.js`

- `GET /api/auth/login`: generate `state = crypto.randomUUID()`, set cookie `xt_oauth_state`
  (maxAge 600), 302 to
  `https://github.com/login/oauth/authorize?client_id=...&redirect_uri=${PUBLIC_APP_URL}/api/auth/callback&scope=read:user&state=...`.
- `GET /api/auth/callback?code&state`:
  1. state must equal the `xt_oauth_state` cookie, else 400.
  2. POST `https://github.com/login/oauth/access_token` (`accept: application/json`) with
     client id/secret/code/redirect_uri → `access_token`.
  3. GET `https://api.github.com/user` with `authorization: Bearer <token>`,
     `user-agent: x-thread-draft-tool`.
  4. Upsert: `insert into users (github_id, login, name, avatar_url) values (...) on conflict (github_id)
     do update set login=excluded.login, name=excluded.name, avatar_url=excluded.avatar_url, updated_at=now() returning *`.
  5. 302 to `PUBLIC_APP_URL + '/'` with the session cookie set and the state cookie cleared.
  - The GitHub access token is **not** stored anywhere.
- `GET /api/auth/me` → `{ user: { id, login, name, avatar_url } }` or `{ user: null }` (always 200).
- `POST /api/auth/logout` → `{ ok: true }` + cleared session cookie.

### Task 1.7 — `server/routes/drafts.js`

All writes are owner-scoped in SQL (`... where id = $1 and user_id = $2`). A non-owner and a
missing draft both return **404** (never reveal existence on writes).

| Method + path | Auth | Behaviour |
|---|---|---|
| `GET /api/drafts?published=true\|false` | required | Owner's drafts; unpublished ordered by `updated_at desc`, published by `published_at desc`. → `{ drafts: [...] }` |
| `POST /api/drafts` `{ title, posts }` | required | Insert with `user_id = session.uid`. Validate `posts` is an array, title string ≤ 500 chars. → `{ draft }` 201 |
| `GET /api/drafts/:id` | **public** | Anyone with the id can read (matches current share-by-link). Invalid UUID → 404. → `{ draft }` |
| `PATCH /api/drafts/:id` `{ title?, posts? }` | owner | Updates given fields + `updated_at = now()`. → `{ draft }` |
| `POST /api/drafts/:id/publish` | owner | Delete all Blob images referenced in `posts` (see 1.8 `deleteBlobUrls`), set every post's `images` to `[]`, `is_published = true`, `published_at = now()`. → `{ draft }` |
| `DELETE /api/drafts/:id` | owner | Delete Blob images of the draft, then the row. → `{ ok: true }` |
| `POST /api/drafts/:id/share-tokens` | owner | Insert token → `{ token }` 201 |

Draft JSON returned to the client uses the same field names as today
(`id, user_id, title, posts, is_published, published_at, created_at, updated_at`).

### Task 1.8 — `server/routes/images.js` and `server/blob.js`

- `server/blob.js`: wraps `@vercel/blob` (`put`, `del`) so tests can mock one module.
  - `deleteBlobUrls(urls)`: only deletes URLs whose host ends with `.public.blob.vercel-storage.com`;
    ignores others; never throws (logs errors).
- `POST /api/images?draftId=<uuid>` (owner of that draft required):
  - Body is the raw file bytes; `content-type` must start with `image/`; size ≤ 4 MB
    (check `content-length` and actual `arrayBuffer().byteLength`) else 413.
  - `put(`drafts/${uid}/${draftId}/${crypto.randomUUID()}.${ext}`, bytes, { access: 'public', contentType, addRandomSuffix: true })`.
  - → `{ url }` 201.
- `DELETE /api/images` `{ url }`: allowed only if the URL pathname starts with `/drafts/<session.uid>/`; else 403.

### Task 1.9 — Share links: `server/share/render.js` and `server/routes/share.js`

- `git mv supabase/functions/share/render.ts server/share/render.js`, then strip TypeScript:
  remove `type` declarations/annotations; keep every exported function and its behaviour.
  Keep exported types as JSDoc `@typedef` comments.
- Update imports in `tests/unit/render.test.ts` and `tests/e2e/x-thread-page.spec.ts` to
  `../../server/share/render.js`; replace `type Payload` / `type Post` imports with local
  type aliases inside the test files. Both test suites must stay green with no assertion changes
  (except the URL host/path in `extractTokenAndFormat` test inputs if needed).
- `GET /api/share/:token[.md|.html]` and `?format=html|md` (public, no auth):
  1. `extractTokenAndFormat(url)`; invalid → 400.
  2. Atomic consume: `update share_tokens set used = true, used_at = now() where token = $1 and used = false returning draft_id`.
  3. No row → 410 "Link expired or invalid" (HTML or text, per format).
  4. `select d.title, d.posts, d.created_at, coalesce(u.name, u.login) as author_name, u.login as author_handle, u.avatar_url as author_avatar from drafts d left join users u on u.id = d.user_id where d.id = $1`.
  5. `renderHtml(payload)` / `renderMarkdown(title, posts)` with the existing response helpers.
     Add header `cache-control: no-store` and `x-robots-tag: noindex`.
- Delete the Supabase-gateway `.html` → `?format=html` redirect hack; it is not needed on Vercel.

### Task 1.10 — `server/router.js` + `api/handler.js`

- `server/router.js` exports `route(request)`:
  - Path = `url.searchParams.get('__path')` if present, else `url.pathname` without the `/api/` prefix.
  - Match with a small table of `{ method, pattern: RegExp, handler }`; 404 JSON if none; 405 if path matches but method doesn't.
  - CSRF: for non-GET/HEAD, if an `origin` header is present and ≠ `PUBLIC_APP_URL` → 403.
  - Catches `HttpError` → `error(status, message)`; any other error → log + 500 `{ error: 'Server error' }`.
  - `GET /api/health` → `{ ok: true }` (no DB).
- `api/handler.js`:
```js
import { route } from '../server/router.js'
export const GET = route
export const POST = route
export const PATCH = route
export const DELETE = route
```

### Task 1.11 — API tests (`tests/api/`)

One test file per route module, using PGlite + mocked `server/blob.js` (`vi.mock`) + mocked
`fetch` for GitHub. Build requests with `new Request('https://app.test/api/...', {...})` and call `route()`.
Required cases (minimum):
- auth: login redirect contains state + sets cookie; callback rejects bad state; callback upserts
  user and sets `xt_session`; second login with same `github_id` reuses the same `users.id`; me with/without cookie; logout clears cookie.
- drafts: list only returns own drafts and respects `published`; create; public GET by id works
  without cookie; PATCH/DELETE/publish by non-owner → 404 and row unchanged; publish clears images and calls `deleteBlobUrls`; invalid UUID → 404.
- images: rejects non-image, >4 MB, non-owner draft; delete outside own prefix → 403.
- share: owner creates token; first GET returns md/html with author; second GET → 410; concurrent
  double consume (two `route()` calls via `Promise.all`) → exactly one 200.
- router: unknown path 404; wrong method 405; foreign `origin` on POST → 403; health ok.

Done when `npm run test:api` and `npm run test:unit` pass.

---

## Phase 2 — Frontend (Haiku)

### Task 2.1 — API client

Replace `src/utils/api.js` entirely:
```js
async function request(path, { method = 'GET', body, headers } = {}) // fetch('/api' + path, credentials: 'same-origin'); JSON in/out; throws Error(body.error || `HTTP ${status}`) with err.status set
export const authApi = { me, login /* window.location.href = '/api/auth/login' */, logout }
export const draftsApi = { list(published), create({ title, posts }), get(id), update(id, patch), publish(id), remove(id), createShareToken(id) }
export const imagesApi = { upload(file, draftId) /* raw body, content-type file.type */, remove(url) }
```

### Task 2.2 — Replace `src/utils/supabase.js` with `src/utils/images.js`

Keep `isOwner`, `normalizeImages`, `uploadImageFromUrl` (now calls `imagesApi.upload`),
`uploadImage(file, draftId)` → `imagesApi.upload`, `deleteImage(url)` → `imagesApi.remove`.
Drop `deleteAllDraftImages` (publish is server-side now). Delete `src/utils/supabase.js`.

### Task 2.3 — Component updates

| File | Change |
|---|---|
| `src/App.jsx` | On mount `authApi.me()` → `setUser(res.user)`; remove `session` state and Supabase listener. |
| `src/components/LoginPage.jsx` | Button calls `authApi.login()`. Remove Supabase import. |
| `src/components/DraftList.jsx` | Use `draftsApi.list(false/true)`, `create`, `remove`. Same UI. |
| `src/pages/DraftEditor.jsx` | `draftsApi.get(id)` (on error and `!user`, keep IndexedDB fallback); save → `draftsApi.update(id, { title, posts })`; publish → `draftsApi.publish(id)`; logout → `authApi.logout()` then `navigate('/')` and reload. Imports from `../utils/images`. |
| `src/components/ImageUpload.jsx` | Remove `supabase.auth.getUser()` checks; call `uploadImage(file, draftId)`; on `err.status === 401` show "You must be logged in to upload images". |
| `src/components/AgentLinkButton.jsx` | `draftsApi.createShareToken(draftId)`; URL = `${window.location.origin}/api/share/${token}.md`. |
| `src/components/XThreadLinkButton.jsx` | `draftsApi.createShareToken(draftId)`; URL unchanged (`/x-thread-preview/:token`). |
| `src/pages/XThreadPreviewPage.jsx` | Fetch `/api/share/${token}?format=html` (same origin). Remove `VITE_SUPABASE_URL`. |
| `tests/unit/XThreadLinkButton.test.jsx` | Mock `../../src/utils/api` (`draftsApi.createShareToken`) instead of Supabase. |

Delete dead code (verified unused by grep): `src/components/DraftManager.jsx`,
`src/components/Auth.jsx`, `src/utils/auth.js`. Re-run
`grep -rn "supabase" src tests` → must return nothing.

### Task 2.4 — `vite.config.js` (PWA)

- Remove both `*.supabase.co` runtime caching rules.
- Add `{ urlPattern: ({ url }) => url.pathname.startsWith('/api/'), handler: 'NetworkOnly' }`.
- Add `navigateFallbackDenylist: [/^\/api\//]` to `workbox` (otherwise the service worker serves
  `index.html` for `/api/auth/login` and login breaks for installed PWAs).

### Task 2.5 — `vercel.json`

Keep `buildCommand`, `outputDirectory`, `framework`. Rewrites **in this order**:
```json
"rewrites": [
  { "source": "/api/:path*", "destination": "/api/handler?__path=:path*" },
  { "source": "/((?!api/).*)", "destination": "/index.html" }
]
```

### Task 2.6 — Remove Supabase

- `npm uninstall @supabase/supabase-js`.
- `git rm -r supabase/` (render already moved), `.github/workflows/keep-supabase-alive.yml`,
  `.github/workflows/supabase-deploy.yml`.
- Add `.github/workflows/db-migrate.yml`: on push to `main` touching `db/migrations/**` +
  `workflow_dispatch`; job 1 = the destructive-SQL lint copied from the old `supabase-deploy.yml`
  `guard` job but over `db/migrations/*.sql`; job 2 (needs job 1) = `npm ci && npm run db:migrate`
  with `DATABASE_URL_UNPOOLED: ${{ secrets.DATABASE_URL_UNPOOLED }}`.
- In `.github/workflows/tests.yml` unit job, add a step `npm run test:api` after unit tests.

### Task 2.7 — Docs (required by `claude.md`)

- `README.md`, `SETUP.md`: replace Supabase setup with Neon/Blob/GitHub OAuth steps from Phase 0;
  update env var list, project tree, and "Database Schema" (users table, no `auth.users`).
- `docs/architecture/overview.md`: runtime = Vercel (SPA + `/api` function), Neon, Vercel Blob.
- `docs/features/platform-and-auth.md`, `sync-and-offline.md`, `media-attachments.md`,
  `sharing-and-export.md`: replace Supabase wording.
- `docs/operations/ci-cd.md`: new workflows; Supabase ones removed.
- `docs/plans/current.md`: mark this migration in progress/done.
- New changelog file `docs/changelogs/<UTC YYYYMMDD-HHMMSS>-vercel-neon-migration.md`.
- `npm run docs:refresh`, then `npm run precommit:checks` must pass.

---

## Phase 3 — Data migration

### Task 3.1 — `scripts/migrate-from-supabase.mjs` (Haiku writes)

- Env: `SUPABASE_DB_URL`, `DATABASE_URL_UNPOOLED`, `BLOB_READ_WRITE_TOKEN`. Flag `--dry-run`
  (default **on**; `--apply` to write).
- Steps (idempotent; safe to re-run):
  1. Users: `select id, raw_user_meta_data from auth.users` → insert into `users (id, github_id, login, name, avatar_url)`
     using `provider_id` (or `sub`) as `github_id`, `user_name`/`preferred_username` as `login`,
     `full_name`/`name`, `avatar_url`; `on conflict (github_id) do nothing`. Skip and report users without a GitHub id.
  2. Drafts: copy all rows from `public.drafts` (same ids, timestamps) `on conflict (id) do nothing`.
  3. Images: for every image URL in `posts` containing `/storage/v1/object/public/draft-images/`,
     download it, `put()` to Blob under `drafts/<user_id>/<draft_id>/...`, and replace the URL in
     `posts` (string entries and `{ url }` entries). Update the draft row. Keep a `url-map.json`
     so re-runs don't re-upload.
  4. Share tokens: copy only `used = false` rows.
  5. Print counts: users, drafts, images moved/failed, tokens; and every failure.

### Task 3.2 — `.github/workflows/data-migrate.yml` (Haiku writes)

- `workflow_dispatch` with a boolean input `apply` (default `false` = dry run).
- Env from secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD`,
  `DATABASE_URL_UNPOOLED`, `BLOB_READ_WRITE_TOKEN`. Resolve `SUPABASE_DB_URL` exactly like the
  "Resolve database URL" step in `supabase-backup.yml` (`scripts/supabase-db-url.sh` + `::add-mask::`).
- Steps: checkout → setup-node 20 → `npm ci` → `npm run db:migrate` →
  `node scripts/migrate-from-supabase.mjs`, adding `--apply` when the input is true.
- The script also writes its report to `$GITHUB_STEP_SUMMARY`: counts and draft ids only,
  no draft text and no emails.
- Upload `url-map.json` as an artifact (retention 30 days).

### Task 3.3 — Run it **[HUMAN, phone]**

After the PR is merged: GitHub app → Actions → **Data migrate** → Run workflow on `main` with
`apply` off → read the summary → run again with `apply` on. Re-running is safe.

---

## Phase 4 — Cutover **[HUMAN]** + verification

0. Before testing: Vercel → Settings → **Deployment Protection** → Vercel Authentication *Disabled*
   (see agent-access.md). Until production data is migrated, preview databases are copies of the
   **empty** production Neon database: you start with no drafts and sign in fresh — that is expected.
1. PR #21 is the PR. On the **Preview** deployment (`https://x-thread-draft-tool-preview.vercel.app`):
   open `<preview>/api/health` in the phone browser → `{"ok":true}` (proves rewrite + function wiring);
   sign in with GitHub; create/edit/duplicate/delete a draft; upload a file image and a URL image;
   publish (images disappear); X Thread link opens once then shows expired; Agent `.md` link works once;
   open a draft link in a private tab (read-only view); turn on airplane mode, edit, turn it off → change is saved.
2. Merge the PR and run Task 3.3 (Data migrate) **immediately**: from the merge until the copy
   finishes (a few minutes), production shows empty draft lists (drafts are still in each device's
   IndexedDB and in Supabase). Then repeat the step-1 smoke test on production
   with a real migrated draft.
3. Remove `VITE_SUPABASE_*` from Vercel env.
4. Keep the Supabase project untouched for 14 days as a fallback, then delete it, and delete
   `.github/workflows/supabase-backup.yml`, `scripts/supabase-db-url.sh` and the `SUPABASE_*` / `BACKUP_PASSPHRASE` secrets.

Rollback: revert the merge commit on `main` (Vercel redeploys the Supabase version). Data written
to Neon after cutover would need to be re-entered, so decide within the first day.

---

## Risks

| Risk | Mitigation |
|---|---|
| Rewrite `__path` wiring differs on Vercel | `/api/health` check on preview first; router also falls back to `url.pathname`. |
| Neon cold start (~0.5 s after 5 min idle) | Acceptable; drafts are cached in IndexedDB. |
| Hobby/Neon/Blob free limits (1 GB DB, 1 GB Blob) | Publish deletes images; 4 MB cap; limits stop service, they never bill. |
| Open sign-up → storage abuse | Monitor Blob usage; add per-user quota later if needed. |
| Service worker caches old Supabase bundle | `registerType: 'prompt'` already shows update; users refresh once. |
| Vercel Hobby is non-commercial | Fine for personal use. |

## Validation checklist (for the reviewer)

- [ ] `grep -rni supabase src tests api server vite.config.js package.json vercel.json` → nothing. *Partly: the only matches are `tests/api/migrate-from-supabase.test.js` (tests the kept one-time migration helper), and the migration script, which is outside this list.*
- [x] Every write query in `server/routes/drafts.js`/`images.js`/`tokens.js` is filtered by the caller's user id.
- [x] `GET /api/drafts/:id` is the only unauthenticated draft read; no list endpoint is public. (Export `GET /api/drafts/:id/export` is also public by id, as agent-access.md specifies.)
- [x] Share consume is a single `UPDATE ... RETURNING`; concurrency test exists and passes.
- [x] OAuth `state` checked; GitHub token not persisted; cookie `HttpOnly; Secure; SameSite=Lax`.
- [x] `navigateFallbackDenylist` includes `/api/` (and `/llms.txt`).
- [x] `vercel.json` API rewrite precedes the SPA rewrite.
- [x] Only one file under `api/`.
- [x] `npm run build`, `npm run test:unit`, `npm run test:api`, `npm run test:e2e` pass (e2e 13/13 with the preinstalled Chromium).
- [x] Docs + changelog file updated; `docs:refresh` run.
- [x] Migration SQL is additive only; migrator is idempotent (run twice in a test).
