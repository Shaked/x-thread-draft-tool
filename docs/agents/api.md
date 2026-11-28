# Using X Thread Draft Tool as an agent

Everything the web UI does is available as JSON over HTTP, with the same permissions as the
signed-in GitHub user. Start with `/llms.txt` (short) or `/api/openapi.json` (every endpoint).

- Preview: `https://x-thread-draft-tool-preview.vercel.app`
- Local: `npm run dev:api` → `http://127.0.0.1:8787`

## Auth

Two ways to authenticate. The bearer header wins when present: an invalid, expired or revoked
token is always `401`, never a fallback to the cookie.

| Credential | How you get it | Used for |
|---|---|---|
| `Authorization: Bearer xta_...` | MCP connector (OAuth), or device flow / `npm run agent:login` | REST API (`<origin>/api`) and MCP (`<origin>/api/mcp`) |
| `Authorization: Bearer xt_...` | Web UI `/settings/tokens` (hand-made, quick tests) | Every endpoint |
| `xt_session` cookie | Sign in with GitHub in a browser | Browser use; required to create tokens |

An access token (`xta_`) lasts 1 hour and is bound to one resource: a token for the REST API
is refused on `/api/mcp`, and the reverse. It refreshes with a rotating refresh token (`xtr_`,
90 days unused), at `POST /api/oauth/token` with `grant_type=refresh_token`. Reusing a spent
refresh token revokes its whole connected app. A loopback redirect URI (`localhost` or `127.0.0.1`, http) matches a registered one with any port, so a CLI can pick a free port. At the token endpoint `resource` is optional: when it is absent, the resource the code was issued for is used. The MCP connector's tools are listed in `server/mcp/tools.js`; `tests/api/mcp-coverage.test.js` fails when a REST route has neither a tool nor a documented exclusion.

Hand-made `xt_` tokens are personal (they act as the GitHub user who created them), expire after
7 days at most, and can be revoked at any time. At most 20 are active per user. The plaintext is
shown once; the server keeps only its SHA-256 hash. An invalid, expired or revoked token is always
`401`, never a fallback to the cookie. A hand-made token older than 7 days (including tokens
created before the cap) gets a `401` whose message says it expired and points to the device flow
or OAuth.

### Connect as an MCP connector
Setup recipes, the tool list and troubleshooting: [mcp.md](./mcp.md).


Add `$BASE/api/mcp` as a remote MCP connector. The client discovers the authorization server from
`$BASE/.well-known/oauth-protected-resource/api/mcp`, you approve once with GitHub sign-in, and the
client refreshes its access token by itself.

**Sign-in limit on long authorize requests.** If you are signed out, the server keeps your authorize request (`/api/oauth/authorize?...`) across GitHub sign-in only when it is 2,000 characters or shorter. A longer one is dropped: after GitHub sign-in you land on the app's home page, not the consent page. You are signed in by then, so start the connection again from your client and the consent page opens directly. To avoid the extra step, keep `client_id`, `redirect_uri` and `state` short. A registered `client_id` and a `state` of a few dozen characters stay well under the limit.

### Get a token without a browser (device flow)

```bash
curl -s -X POST $BASE/api/auth/device/start -H 'content-type: application/json' -d '{}'
# → { "device_code", "user_code": "ABCD-1234", "verification_uri", "interval", "expires_in" }
# Show the user: "Open https://github.com/login/device and enter ABCD-1234"
curl -s -X POST $BASE/api/auth/device/poll -H 'content-type: application/json' \
  -d '{"device_code":"DEVICE_CODE","name":"Claude agent"}'
# 202 { "status": "pending" } → wait `interval` seconds and poll again
# 201 { "access_token": "xta_...", "refresh_token": "xtr_...", "expires_in": 3600,
#       "client_id": "device:Claude agent", "token": "xta_...", "user": {...} }
#     → store the refresh token; "token" is a deprecated alias of access_token
```

The device name is a connected app: signing in again with the same name reuses it, and a revoked
one is replaced by a new one. Device flow needs "Enable Device Flow" on the GitHub OAuth App
(one-time, done by the app owner).

### Or from the browser

Sign in at `/settings/tokens`, create a hand-made `xt_` token (7 days max), copy it.

### Local CLI helper

```bash
node scripts/agent-login.mjs --base $BASE --name "Claude agent"   # saves the pair (mode 600)
XT_TOKEN=$(node scripts/xt-token.mjs) npm run smoke              # prints a fresh access token
```

`agent-login` writes `~/.config/xt/credentials.json` (directory 700, file 600): the base URL, the
client id, the refresh token and the current access token. `xt-token` returns the stored access
token while it is valid, otherwise it refreshes, saves the rotated refresh token and prints the new
access token. If it fails, it says to run `npm run agent:login` again. Set `XT_CREDENTIALS_FILE` to
use another file. Do not run two refreshes at once: the second would reuse the first's spent token and
revoke the connected app.

## Error format and status codes

Errors are JSON: `{ "error": "message" }`.

| Status | Meaning |
|---|---|
| 400 | Invalid input (the message says what) |
| 401 | Not signed in, or invalid/expired/revoked token |
| 403 | Refused (for example, creating a token with a bearer token, managing API tokens with an OAuth access token, or a foreign origin with a cookie) |
| 404 | Not found, or not yours (writes never reveal that another user's draft exists) |
| 409 | Token limit reached |
| 410 | Share link expired, stopped, already used, or unknown |
| 413 / 415 | Too large / wrong content type (images) |
| 502 | GitHub or the image host failed |

## Limits

- Post text: the write endpoints reject text longer than 4000 characters, or over 280 as X counts them (use `POST /api/threads/split` for long text). Counts follow the X rules: a URL counts 23, an emoji counts 2, Hebrew and Latin letters count 1. `chars` in the answers uses the same count.
- Posts: each post in `posts` must be an object with a string `id`. Any other post makes a create or update answer `400` and write nothing. Drafts saved before this rule still read as they are.
- Images: 4 MB each, `image/*` only, up to 4 per post.
- Request bodies: 1 MB for JSON (100 KB for `/api/threads/split`).
- Draft lists: `limit` 1–200, default 100; there is no cursor yet.

## Endpoints

Set `BASE` and `TOKEN` first. "Owner" means the draft must belong to the token's user.

### Identity

```bash
curl -s $BASE/api/auth/me -H "Authorization: Bearer $TOKEN"        # { user, auth: "token" }
curl -s -X POST $BASE/api/auth/logout                               # browser sessions only
```

`POST /api/auth/logout` ends this browser's session on the server (the cookie value stops working at once). It does not disconnect AI apps or API tokens: the Connected apps page (`/settings/apps`) does that for apps, and the API tokens page (`/settings/tokens`) for tokens.

### Tokens

```bash
curl -s $BASE/api/tokens -H "Authorization: Bearer $TOKEN"                     # list (no secrets); xt_ or session only, OAuth gets 403
curl -s -X POST $BASE/api/tokens -H 'content-type: application/json' \
  -H "Cookie: xt_session=..." -d '{"name":"laptop","expires_in_days":7}'       # session only
curl -s -X DELETE $BASE/api/tokens/TOKEN_ID -H "Authorization: Bearer $TOKEN"  # revoke
```

### Drafts

```bash
# List (published=true|false is required; limit optional)
curl -s "$BASE/api/drafts?published=false&limit=50" -H "Authorization: Bearer $TOKEN"

# Create
curl -s -X POST $BASE/api/drafts -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"title":"Launch","posts":[{"id":"p1","text":"Hello","images":[],"embeddedTweet":null}]}'

# Summaries of the list (no post text): add view=summary. Counts only, so it stays small.
curl -s "$BASE/api/drafts?published=false&view=summary" -H "Authorization: Bearer $TOKEN"

# Outline (owner only): per post index, chars, remaining, over_limit, image_count and a 40-character preview
curl -s $BASE/api/drafts/DRAFT_ID/outline -H "Authorization: Bearer $TOKEN"

# Revisions (owner only, 404 for anyone else): newest first, limit 1..100 (default 30), before=<seq> for the next page (next_before in the answer).
# Each has seq, version, created_at, actor_kind, actor_name, label and summary (a line like "changed post 2, added post 5 after post 4"; no post text).
curl -s "$BASE/api/drafts/DRAFT_ID/revisions?limit=30" -H "Authorization: Bearer $TOKEN"
# One revision: the draft as it was then (state) and diff from the revision before. against=<seq> picks another one; against=current compares with the draft now.
curl -s "$BASE/api/drafts/DRAFT_ID/revisions/7?against=current" -H "Authorization: Bearer $TOKEN"

# Restore a revision (owner only): the state at seq becomes the current state, as a new version and the revision "Restored revision 7".
# Send the version you read as If-Match (for example "21"); a stale one is 412 with the current draft and nothing is written.
# Answer: { draft, restored_from, images_not_restored }. Images whose file is gone are dropped from their posts and counted.
curl -s -X POST $BASE/api/drafts/DRAFT_ID/revisions/7/restore -H "Authorization: Bearer $TOKEN" -H 'If-Match: "21"'

# Read by id (owner only: another user gets 404, no token or session gets 401)
curl -s $BASE/api/drafts/DRAFT_ID -H "Authorization: Bearer $TOKEN"

# Did it change? Send the ETag you hold as If-None-Match: 304 with no body when the version is unchanged (#360). A weak tag, * or a malformed value gets the draft.
curl -s -o /dev/null -w '%{http_code}\n' $BASE/api/drafts/DRAFT_ID -H "Authorization: Bearer $TOKEN" -H 'If-None-Match: "3"'

# Update title and/or posts (owner). Atomic; sending what the draft already holds is a 200 with no write.
# Same If-Match rules as the per-post PATCH below (see "Concurrent edits").
curl -s -X PATCH $BASE/api/drafts/DRAFT_ID -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"posts":[{"id":"p1","text":"Edited","images":[]}]}'

# Change the text of one post (owner). Atomic: a replay of the same text is a 200 with no write.
# Send If-Match with the draft "version" you read; a stale one is 412 with the current version.
# Refused: 409 for a published draft, 404 for an unknown post, 400 for text over 280 characters or any other field.
curl -s -X PATCH $BASE/api/drafts/DRAFT_ID/posts/p1 -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -H 'If-Match: "3"' -d '{"text":"Edited"}'

# Add, move and remove posts and images (owner). Each is one route with the rules of the MCP tools (#412).
# Same If-Match rules as above: a stale version is 412 with no write. 409 for a published draft, 422 for a broken rule.
curl -s -X POST $BASE/api/drafts/DRAFT_ID/posts -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"text":"New post","after_post_id":"p1"}'    # after_post_id and post_id are optional
curl -s -X POST $BASE/api/drafts/DRAFT_ID/posts/p3/move -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"position":1}'                              # with "image_url": move that image to p3 at position
curl -s -X DELETE $BASE/api/drafts/DRAFT_ID/posts/p3 -H "Authorization: Bearer $TOKEN"  # a draft keeps one post
curl -s -X POST $BASE/api/drafts/DRAFT_ID/images -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"url":"https://example.com/a.png","post_id":"p1","position":2}'   # at most 4 per post
curl -s -X POST $BASE/api/drafts/DRAFT_ID/images -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"url":"https://example.com/b.png","replace":"OLD_IMAGE_URL"}'
curl -s -X DELETE $BASE/api/drafts/DRAFT_ID/images -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"post_id":"p1"}'                              # or {"url":"IMAGE_URL"}; → { draft, removed, deleted }

# Duplicate (owner) → 201 with the copy, titled "<title> (copy)"
curl -s -X POST $BASE/api/drafts/DRAFT_ID/duplicate -H "Authorization: Bearer $TOKEN"

# Export (owner only): format=json (default), text, or formatted
curl -s "$BASE/api/drafts/DRAFT_ID/export?format=text" -H "Authorization: Bearer $TOKEN"

# Publish (owner): deletes the draft's images and clears them from posts. Atomic; publishing again is a 200 with no write.
curl -s -X POST $BASE/api/drafts/DRAFT_ID/publish -H "Authorization: Bearer $TOKEN"

# Delete (owner): deletes the draft and its images
curl -s -X DELETE $BASE/api/drafts/DRAFT_ID -H "Authorization: Bearer $TOKEN"
```

### Split text into posts (no auth)

```bash
curl -s $BASE/api/threads/split -H 'content-type: application/json' \
  -d '{"text":"Long text ...","max_chars":280}'
# → { "posts": [{ "text": "...", "chars": 123 }, ...] }
```

### Share links

```bash
# Create (owner) → { token, expires_at, one_time }. No body: one-time, expires in 1 hour.
curl -s -X POST $BASE/api/drafts/DRAFT_ID/share-tokens -H "Authorization: Bearer $TOKEN"

# Options, all optional: expires_in is 60 to 604800 seconds; one_time false means readable until it expires
curl -s -X POST $BASE/api/drafts/DRAFT_ID/share-tokens -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" -d '{"expires_in":86400,"one_time":false}'

# Read as markdown (default) or HTML. A one-time link answers 410 on the second read.
curl -s $BASE/api/share/SHARE_TOKEN.md
curl -s $BASE/api/share/SHARE_TOKEN.html

# Stop one link, or every link of the draft (owner). Both answer 204; a stopped link answers 410.
Each link is a row on the server with an `expires_at`: it stops at that time, or at once when revoked.
curl -s -X DELETE $BASE/api/drafts/DRAFT_ID/share-tokens/SHARE_TOKEN -H "Authorization: Bearer $TOKEN"
curl -s -X DELETE $BASE/api/drafts/DRAFT_ID/share-tokens -H "Authorization: Bearer $TOKEN"
```

The default lifetime is 1 hour. The server reads `SHARE_LINK_TTL_SECONDS` (60 to 604800) for the default, if it is set.

### Images

```bash
# Upload raw bytes for a draft you own (4 MB max)
curl -s -X POST "$BASE/api/images?draftId=DRAFT_ID" -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: image/png' --data-binary @photo.png        # → { url }

# Or let the server fetch a public image URL (no private addresses, no redirects)
curl -s -X POST $BASE/api/images/from-url -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"draftId":"DRAFT_ID","url":"https://example.com/photo.png"}'

# A one-time upload link for one post (30 minutes, up to the free slots, 10 links per hour)
curl -s -X POST $BASE/api/drafts/DRAFT_ID/posts/POST_ID/upload-links -H "Authorization: Bearer $TOKEN"   # → { url: ".../upload#<token>", post, slots, expires_at }
# The page behind the link uses the token after the # (never sent to a server) as a bearer token, with no session:
curl -s $BASE/api/upload-links -H "Authorization: Bearer $LINK_TOKEN"                                     # → { post, remaining, expires_at }
curl -s -X POST $BASE/api/upload-links/images -H "Authorization: Bearer $LINK_TOKEN" \
  -H 'content-type: image/png' --data-binary @photo.png                                                  # → { url, remaining }; 410 when the link is dead

# Delete one of your own images
curl -s -X DELETE $BASE/api/images -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"url":"IMAGE_URL"}'

# Delete only when no draft of yours still uses the URL (in an image or in text)
curl -s -X DELETE $BASE/api/images -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"url":"IMAGE_URL","if_unused":true}'   # → { ok, deleted: true|false }
```

`if_unused` is optional. With `true` the file is kept (`deleted: false`) while any of your drafts still has the URL; without it, or with `false`, the file is deleted and the answer is `{ ok: true }`. Another user's image is 403 either way.

### Discovery

```bash
curl -s $BASE/llms.txt
curl -s $BASE/api/openapi.json
curl -s $BASE/api/health
# Live commit, deploy time and database schema (public, no token)
curl -s $BASE/api/version
```

## How to test at each level

The pre-commit hook scans staged files with gitleaks when it is installed locally (`.gitleaks.toml`); CI's `gitleaks` job is the enforcing check.

| Level | Command | Needs network? | Needs secrets? |
|---|---|---|---|
| 1. Unit + API | `npm ci && npm run test:unit` | npm registry only | no |
| 2. Local headless | `npm run dev:api` in one terminal, then `XT_BASE_URL=http://127.0.0.1:8787 XT_TOKEN=$(curl -s -XPOST localhost:8787/api/dev/token -H 'content-type: application/json' -d '{"login":"agent"}' \| node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).token") npm run smoke` | no | no |
| 3. Deployed | `XT_BASE_URL=$BASE npm run smoke` | the app host | an API token |

`npm run smoke` creates drafts titled `[smoke] <timestamp>` in the token owner's account and
deletes them, even if a step fails. It prints PASS/FAIL per step and never prints the token.
Set `XT_SMOKE_PUBLIC=1` to run only the steps that need no account (account steps print SKIP).
The automatic deployed smoke test (`.github/workflows/smoke-deployed.yml`) runs the full test on Preview and Production deployments. It signs in with a GitHub OIDC identity (`auth: ci-oidc`), so it needs no stored token. No long-lived smoke token is stored (the XT_SMOKE_TOKEN* secrets were removed in Task 27).

`/api/dev/token` exists only on the local headless server. It is not part of the Vercel function.

## Agent access in Claude Code cloud

1. **Vercel preview protection:** the app owner disables Vercel Authentication on Deployment
   Protection (the app has its own GitHub auth), or stores a bypass secret.
2. **Enable Device Flow** on the GitHub OAuth App.
3. **Create a token** on `/settings/tokens` (preview or production), named for the agent.
4. **Claude cloud sessions:** an agent that needs level-3 access asks the environment for a
   network change covering exactly `x-thread-draft-tool-preview.vercel.app` and
   `x-thread-draft-tool.vercel.app`, then requests the bearer credential for those hosts. The proxy
   injects `Authorization: Bearer …`, and the agent runs `npm run smoke` without `XT_TOKEN`.

**Network reality:** Claude Code cloud sessions cannot reach `*.vercel.app` by default. Per-deployment
URLs (`x-thread-draft-tool-<hash>-….vercel.app`) cannot be allowed, because wildcards are not
permitted. Use the two stable domains.

**Databases behind previews:** each Preview deployment can get its own Neon branch. If a new
preview answers 401 to a token that worked before, create a new token on that preview.

Only `main` and the stable branch `claude/lucid-sagan-bbciuo` deploy (`vercel.json` `git.deploymentEnabled`). A PR is put on the stable preview by the runbook's P-PREVIEW (`docs/plans/hardening-finish.md`).

**Neon preview branches:** `.github/workflows/neon-preview-cleanup.yml` runs `scripts/neon-preview-cleanup.mjs`. On each PR push it runs `preflight`: reuse the PR's `preview/<branch>`, or make room when the project is at its branch limit (`branches_limit`, 10 on the free plan), or stop with exit 2. On close it deletes that PR's branch. A daily run deletes merged and closed-unmerged previews after 24 hours. `main`, the default, primary, delete-restricted or protected branches and the stable preview are never deleted.

## CI identity (GitHub Actions OIDC)

GitHub Actions can call the API without a stored token. The workflow requests a short-lived OIDC identity
token for the deployment's audience (`x-thread-draft-tool-ci-preview` or `…-ci-production`) and sends it as
`Authorization: Bearer <jwt>`. The server (`server/oidc-ci.js`) accepts it only when all of these hold:

- `CI_OIDC_ENABLED=1` and `CI_OIDC_REPOSITORY_ID` (the numeric repository id) are set for that environment.
- The token is RS256, issued by `https://token.actions.githubusercontent.com`, not older than 5 minutes.
- `repository_id`, `workflow_ref` and `job_workflow_ref` name this repository and `.github/workflows/ui-image-upload.yml`.
- The event is `workflow_dispatch` or `deployment_status`, on the runner `github-hosted`.
- The ref is `refs/heads/main`, or a branch on a preview only when `CI_OIDC_ALLOW_BRANCHES=1`.

The caller is the `ci-smoke` user, and it sees only its own drafts. CI tokens work only on the routes marked
`ci: true` in `server/routes/*.js`; other routes refuse them with 401. Cookies and `xt_` tokens are unchanged.

## Concurrent edits: ETag and If-Match

Every write (PATCH a draft, PATCH one post, publish) runs in one transaction on a locked row and
adds 1 to the draft `version`. `GET /api/drafts/:id` and every write response carry `ETag: "<version>"`.
The full picture (who sends which version, the editor, the 304 check): [docs/architecture/draft-sync.md](../architecture/draft-sync.md).

- Send `If-Match: "<version>"` with a write to refuse it when the draft changed since you read it.
  A stale tag is `412` with `{ "error": "...", "version": <current>, "draft": <current draft> }` (and the `ETag` header); nothing is written.
  Re-read, then decide whether to repeat the change. Do not retry blindly.
- `If-Match: *` matches any current version. No header means no check.
- A weak tag (`W/"3"`) never matches on a write (RFC 9110 strong comparison): `412`.
- Anything else (`3` without quotes, a list, text) is `400`.
- A replay is `200` with no write and no version change: the same text on a post, the same title and posts on
  a whole-draft PATCH, publish of a published draft. The replay check runs before If-Match, so a retry of a
  write that already landed succeeds even though its tag is now stale.
- Errors: `400` malformed header or body, `404` not found or not yours, `409` published draft (post routes),
  `412` stale version.
- The post and image routes (`POST /drafts/:id/posts`, `DELETE /drafts/:id/posts/:postId`, `POST /drafts/:id/posts/:postId/move`,
  `POST` and `DELETE /drafts/:id/images`) read the draft and write it with one UPDATE that re-checks the version it read.
  With `If-Match` a stale version is `412`; without it, a write that landed in between makes the route plan the edit again on the newer draft.
- MCP: `move_post`, `remove_image` and `add_image_from_url` with `replace` take an optional `version`, as do
  `update_draft` and `update_post` (from `get_draft`). A conflict is a tool error
  (`isError`) with the current `version`, telling you to call `get_draft` again. `add_post` takes an optional `post_id`: the same id and text
  again changes nothing; the same id with other text is a 409 tool error.
