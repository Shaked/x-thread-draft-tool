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
| `Authorization: Bearer xt_...` | Web UI `/settings/tokens`, device flow, or `npm run agent:login` | Every endpoint |
| `xt_session` cookie | Sign in with GitHub in a browser | Browser use; required to create tokens |

Tokens are personal (they act as the GitHub user who created them), expire after 7 days by
default (max 7), and can be revoked at any time. At most 20 are active per user. The plaintext
is shown once; the server keeps only its SHA-256 hash.

### Get a token without a browser (device flow)

```bash
curl -s -X POST $BASE/api/auth/device/start -H 'content-type: application/json' -d '{}'
# → { "device_code", "user_code": "ABCD-1234", "verification_uri", "interval", "expires_in" }
# Show the user: "Open https://github.com/login/device and enter ABCD-1234"
curl -s -X POST $BASE/api/auth/device/poll -H 'content-type: application/json' \
  -d '{"device_code":"DEVICE_CODE","name":"Claude agent"}'
# 202 { "status": "pending" } → wait `interval` seconds and poll again
# 201 { "token": "xt_...", "user": {...} } → store it; it is never shown again
```

Device flow needs "Enable Device Flow" on the GitHub OAuth App (one-time, done by the app owner).

### Or from the browser

Sign in at `/settings/tokens`, create a token, copy it.

### Local CLI helper

```bash
node scripts/agent-login.mjs --base $BASE --name "Claude agent"   # writes .xt-token (mode 600)
```

## Error format and status codes

Errors are JSON: `{ "error": "message" }`.

| Status | Meaning |
|---|---|
| 400 | Invalid input (the message says what) |
| 401 | Not signed in, or invalid/expired/revoked token |
| 403 | Refused (for example, creating a token with a bearer token, managing API tokens with an OAuth access token, or a foreign origin with a cookie) |
| 404 | Not found, or not yours (writes never reveal that another user's draft exists) |
| 409 | Token limit reached |
| 410 | One-time share link already used |
| 413 / 415 | Too large / wrong content type (images) |
| 502 | GitHub or the image host failed |

## Limits

- Post text: 280 characters (use `POST /api/threads/split`).
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

# Read by id (public: anyone with the id)
curl -s $BASE/api/drafts/DRAFT_ID

# Update title and/or posts (owner)
curl -s -X PATCH $BASE/api/drafts/DRAFT_ID -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"posts":[{"id":"p1","text":"Edited","images":[]}]}'

# Duplicate (owner) → 201 with the copy, titled "<title> (copy)"
curl -s -X POST $BASE/api/drafts/DRAFT_ID/duplicate -H "Authorization: Bearer $TOKEN"

# Export (public): format=json (default), text, or formatted
curl -s "$BASE/api/drafts/DRAFT_ID/export?format=text"

# Publish (owner): deletes the draft's images and clears them from posts
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

### One-time share links

```bash
# Create (owner) → { token }
curl -s -X POST $BASE/api/drafts/DRAFT_ID/share-tokens -H "Authorization: Bearer $TOKEN"

# Read once as markdown (default) or HTML; the second read returns 410
curl -s $BASE/api/share/SHARE_TOKEN.md
curl -s $BASE/api/share/SHARE_TOKEN.html
```

### Images

```bash
# Upload raw bytes for a draft you own (4 MB max)
curl -s -X POST "$BASE/api/images?draftId=DRAFT_ID" -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: image/png' --data-binary @photo.png        # → { url }

# Or let the server fetch a public image URL (no private addresses, no redirects)
curl -s -X POST $BASE/api/images/from-url -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"draftId":"DRAFT_ID","url":"https://example.com/photo.png"}'

# Delete one of your own images
curl -s -X DELETE $BASE/api/images -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"url":"IMAGE_URL"}'
```

### Discovery

```bash
curl -s $BASE/llms.txt
curl -s $BASE/api/openapi.json
curl -s $BASE/api/health
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
