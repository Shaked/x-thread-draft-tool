# Settings menu: a left menu, version info everywhere, a better tokens page, a changelog (epic #135)

Epic: #135. State: STARTED.

Target file in the repo: `docs/plans/settings-menu.md`. Add it to `docs/plans/index.md`. Open one epic issue for it
(AGENTS.md "Trackers") and record the owner's two requests of 2026-11-14 and the changelog request as decisions.

Written 2026-11-17 (UTC, checked with `date -u`). Read on `main` at `88e2bc2` (checked with `git ls-remote`; it
includes T4 to T7 of epic #111). `src/` is the same as the copy measured below; since then only `server/mcp/*.js` text
changed (D1 of epic #132).

Every fact is marked **[checked]** (read or measured) or **[not checked]**.

Screens of today (Playwright `screens` project, built app + `dev-api --fake-github`, Chromium 1243 via the
`PLAYWRIGHT_BROWSERS_PATH` symlink trick, run on a clean `git archive` copy, nothing written in the repo):
`/tmp/claude-0/-home-user-x-thread-draft-tool/5ebed72c-31a3-5571-9bea-2c2583c63ed9/scratchpad/settings-menu/before-<390|1280>-<name>.png`.

## 1. What the owner asked (2026-11-14 and 2026-11-17)

1. "We removed the last update and version information. It can be somewhere smaller, and available via the API and
   MCP, but it has to be available."
2. "The API tokens button page looks bad. We can have themes, API tokens and other settings available via a left,
   closed-by-default hamburger menu, and make room for more stuff. Then (1) could be available at the bottom there."
3. A "Changelog" item in the same menu: what changed and the versions, in short.
4. (From `docs/plans/mcp-default-use.md`, epic #132, D2/D4.) A "Use with AI apps" card with a Copy button that holds
   the paste-in text, on the settings page, after the redesign.

## 2. State today

| # | Fact | State |
|---|---|---|
| 1 | Deploy time and commit are baked into the client at build: `vercel.json` `buildCommand` sets `VITE_DEPLOYED_AT` (`date -u`) and `VITE_DEPLOY_COMMIT_SHA` (`$VERCEL_GIT_COMMIT_SHA`). `src/App.jsx` lines 36 to 77 format them (12-char sha, local time, "N units ago") and pass three props to `TokensPage`. | [checked] |
| 2 | The only place they show: one grey line at the end of `/settings/tokens`: "About: last deployed ... Version ...". Locally it reads "unknown" for both. | [checked] `before-390-tokens.png` |
| 3 | The server knows nothing about its version. `GET /api/health` answers `{ ok: true }`. OpenAPI `info.version` is a fixed `1.0.0`. MCP `serverInfo.version` is a fixed `0.1.0` (`server/mcp/server.js`). `whoami` returns `{ login }` only. | [checked] |
| 4 | `tests/unit/vercel-config.test.js` pins the build command string exactly; changing the build means changing that constant in the same PR (an intended change, not a weakened test). | [checked] |
| 5 | Draft list header (`src/components/DraftList.jsx`): title, the 3-segment Theme control, the `AppBar` (New draft + sign-out), and an "API tokens" button with class `tab`. `.tab` is styled only inside `.draft-tabs`, so this button renders as a bare browser button (about 68x18 px, 13 px system font). This is the "API tokens button looks bad". | [checked] `before-390-drafts-three-viewport.png`, `before-1280-drafts-three.png`, `App.css` line 511 |
| 6 | At 1280 px the theme control sits between the title and New draft; the tokens button floats at the far right, not aligned. | [checked] `before-1280-drafts-three.png` |
| 7 | Tokens page (`src/pages/TokensPage.jsx`, 270 lines): "Back to drafts", `AppBar` (sign-out only), h1 "API tokens", the Theme control, "Connect an AI app" (4 rows), "Connected apps", a paragraph, the create form, the one-time token box, "Your tokens", the About line. No cards, no visual grouping; the Theme control is unrelated to tokens. 390 px page is 1789 px tall; 1280 px is 1282 px. | [checked] screenshots |
| 8 | The phone bottom bar (`AppBar`, plan `bottom-bar.md` T3b-2) is fixed, `z-index: 100`, and sets `--bar-space` through `:root[data-bar]`. The editor header is `position: sticky; top: 0; z-index: 100`. The emoji picker uses `z-index: 1000`. | [checked] `App.css` 1211 to 1281, 828 |
| 9 | `src/utils/useDismiss.js` closes a menu on Escape and on `pointerdown` outside; Share and Export menus use it. | [checked] |
| 10 | React is 18.2: the `inert` JSX prop is not supported as a boolean (React 19 is). | [checked] `package.json`; the warning itself [not checked] |
| 11 | `docs/changelogs/`: 132 files plus `README.md`, 58 KB in total. Names are `YYYYMMDD-HHMMSS-<slug>.md` (UTC). 83 older files start with a `# Heading` and have sections (up to 3 KB each); newer ones are 1 to 5 bullet lines, often starting with an internal label ("T6: ..."). 23 files on 2026-11-14 alone. `docs/` is not in the app bundle or the API function today. | [checked] |
| 12 | `tests/api/mcp-coverage.test.js`: every REST route is called by an MCP tool or listed in `EXCLUDED`. A new route needs one of the two. | [checked] |
| 13 | The required E2E job (`npm run test:e2e`, project `chromium`) starts `dev:api` and the built app through `webServer` in `playwright.config.ts`; `tests/e2e/app-bar.spec.ts` shows how to sign in with a dev token. | [checked] |
| 14 | `Net lines` check: product code in `src/`, `server/`, `api/`, `scripts/` must not grow unless the PR body matches `docs/plans/<file>.md ... Task <n>`. Every PR here names `docs/plans/settings-menu.md Task <n>`. | [checked] `scripts/net-lines.mjs` |

## 3. Design decisions (planner; Opus checks in review)

| Id | Decision | Reason |
|---|---|---|
| M1 | **One build-info generator.** New `scripts/build-info.mjs` runs as the first step of `npm run build` and writes the gitignored `server/generated/build-info.js` (`export default { commit, deployed_at, schema }`). `vite.config.js` reads the same file and `define`s it for the client. `vercel.json` loses the two `VITE_` assignments. | One source for client, REST and MCP. Local builds write only a gitignored file, so the pre-commit build leaves the tree clean. |
| M2 | `commit` = `VERCEL_GIT_COMMIT_SHA`, else `git rev-parse HEAD`, else `null`. `deployed_at` = build time, ISO UTC. `schema` = the newest file name in `db/migrations/` without `.sql` (today `008_revoked_sessions`). Nothing else: no branch name, no env values, no secrets. | Public-safe. The branch name is left out (preview branch names are internal). |
| M3 | Server reads it with `import('./generated/build-info.js').catch(() => null)`, and falls back to `process.env.VERCEL_GIT_COMMIT_SHA` with `deployed_at: null`. | Works in tests and in `dev:api` before a build. |
| M4 | **REST:** `GET /api/version`, no sign-in, `Cache-Control: public, max-age=60`: `{ commit, commit_short (7), deployed_at, environment, schema }` (`environment` = `VERCEL_ENV` or `"local"`). `/api/health` stays `{ ok: true }`. OpenAPI documents it. | Monitors keep using `/health`; agents get one clear route. |
| M5 | **MCP:** one read-only tool `app_version` that calls `GET /version` (and from Task 5 also returns the 5 newest changelog entries). `serverInfo.version` becomes `0.1.0+<commit_short>` (semver build metadata). `whoami` is unchanged. | A named tool is easy for an agent to find; the build metadata shows in clients that display server info. |
| M6 | **Menu:** a hamburger button at the inline-start of each signed-in page header (list, editor, settings, about, changelog). It opens a drawer from the inline-start side, closed by default, rendered with `createPortal` into `document.body` (a fixed child of a sticky header is fine, but a portal also avoids future `transform`/`backdrop-filter` traps). One component per page, like `AppBar` (bottom-bar.md decision 6). | Same pattern as the bar; login and `/x-thread-preview/:token` never render it. |
| M7 | Drawer contents, top to bottom: header (app name + close button); **Drafts** (link `/`); section **Settings**: Theme (the existing `ThemeSetting`, shown as a vertical radio list inside the drawer by CSS only), **API tokens and apps** (link `/settings/tokens`); **Changelog** (Task 6); a spacer; **Sign out**; at the very bottom a small grey version line (Task 4). Room for more items: each item is one `<li>` in a list. | Matches the owner's words; the version line sits "at the bottom there". |
| M8 | **Behaviour:** closed on load; `aria-expanded` and `aria-controls="app-menu"` on the hamburger; drawer is `role="dialog" aria-modal="true" aria-labelledby`; while open, `#root` gets the `inert` attribute through the DOM (not the JSX prop, fact 10), so the page behind cannot be focused or clicked; focus moves to the first link on open and back to the hamburger on close; Escape, a press on the scrim, the close button, any link in the drawer, and a route change (`useLocation().pathname`) all close it. Escape and outside press reuse `useDismiss(open, panelRef, setOpen)`. Body scroll is locked (`overflow: hidden` on `html`) while open. | Standard modal-drawer rules; reuse the hook instead of a second copy. |
| M9 | **Layers:** scrim and drawer `z-index: 200` (above the bar and the sticky header at 100, below the emoji picker at 1000, which cannot be open at the same time because `#root` is inert). Width `min(320px, 100vw - 48px)`; full height `100dvh`; `padding-bottom: env(safe-area-inset-bottom)`. The bottom bar stays where it is and is covered by the scrim while the drawer is open. | Never fights the bar; never wider than a 320 px phone. |
| M10 | **RTL:** the app is LTR (`<html lang="en">`, bottom-bar.md fact 10). The drawer uses logical properties (`inset-inline-start`, `translate` by `-100%` flipped under `[dir=rtl]`), so it opens from the right if the page is ever RTL. User text inside the drawer (none today; changelog entries later) gets `dir="auto"`. | No owner question needed: it follows the page direction. |
| M11 | **Motion:** 0.2 s slide (`transform`) and fade (scrim); none under `prefers-reduced-motion: reduce`. | Same rule as the bar. |
| M12 | **Tokens page redesign** keeps every behaviour, text meaning, API call and `confirm()` prompt. Layout: h1 "API tokens and apps"; three cards in this order: (a) "Your API tokens" (create form in one row on wide screens, stacked on phones; the one-time token box inside the card, highlighted, with a large Copy button and "Copy this token now. It won't be shown again."; token list as rows with name, prefix chip, dates, and a Revoke button; empty state "No tokens yet. Create one above to let an agent use the API as you."); (b) "Connect an AI app" (four compact rows, Copy button per row, the address in a code chip that wraps); (c) "Connected apps" (rows with Revoke access; empty state as today). Theme and the About line leave the page. Cards use `--surface`, `--border`, 12 px radius, 16 px padding. | Owner said the page looks bad; tokens are the page's name, so they come first. |
| M13 | **Changelog data:** `scripts/build-info.mjs` (M1) also writes `server/generated/changelog.js`: an array, newest first, of `{ id, date, title, summary }` where `id` is the file name without `.md`, `date` is the ISO UTC time from the name, `title` is the first `# ` heading (or null), and `summary` is the first one to three bullet or text lines, markdown links reduced to their text, backticks removed, a leading internal label such as `T6:` or `D-14:` removed, cut to 280 characters at a word boundary. `README.md` is skipped. Expected size about 30 KB [not checked: estimate]. The client never bundles it; it reads the API. | One generator; the function bundle carries the data; no new Vercel config. |
| M14 | `GET /api/changelog?limit=20&before=<id>` → `{ entries, next }` (`next` is the id to pass as `before`, or null), `limit` 1 to 50. Access per owner question Q3 (default: signed-in). `Cache-Control: private, max-age=300` (public if Q3 says public). | Small, pageable, readable by agents with a token. |
| M15 | **Versions in the changelog:** entries are grouped by UTC day, newest first. The page header shows the running version ("Version a1b2c3d, deployed 17 Nov 2026, 14:02"). Per-entry commit links are not built: Vercel clones shallow, so the file-to-commit map is not reliable [not checked: clone depth]. | Smallest design that still shows "the versions". |
| M16 | **About page** `/about` (Task 4): the version line in the drawer links to it. It shows the app build (from M1 `define`) and the server answer (`GET /api/version`), each with commit, deployed time (local and UTC) and a Copy button for "commit + deployed_at". If the two commits differ: "A newer version is live. Reload to update." with a Reload button. Task 6 adds "See what changed" linking to `/changelog`. | The details view the owner asked for; also tells a user with a stale PWA cache what to do. |
| M17 | **"Use with AI apps" card** (Task 7) on the tokens page, under "Connect an AI app": the English and Hebrew paste-in texts from `docs/agents/mcp.md` (epic #132 D2), each in a `<blockquote>` with `lang` and `dir="auto"` and its own Copy button, plus the "where to paste" list (ChatGPT, Claude, Claude Code, Codex). A unit test checks that each UI text appears verbatim in `docs/agents/mcp.md`, so the two cannot drift. | D4 of epic #132 asked for this after the redesign. |

## 4. Tasks

Order: **Task 1, 2, 3, 4, 5, 6, 7.** Each ships alone to production; merge it and check production before the next
(AGENTS.md). Task 7 only needs Task 3 and can move earlier. Every PR body starts with
`Implements docs/plans/settings-menu.md Task <n>` and adds `docs/changelogs/<UTC YYYYMMDD-HHMMSS>-<slug>.md`.
Executor default Haiku; Opus judges every PR; Sonnet where named.

### Task 1 (V1). Version info from the server: REST and MCP — executor Sonnet (build pipeline), judge Opus

Visible after merge: `curl https://<prod>/api/version` returns the live commit and deploy time; the MCP tool
`app_version` answers the same. The UI is unchanged (the About line on the tokens page now reads the same source).

Files: new `scripts/build-info.mjs`, new `server/version.js`, `server/router.js`, `server/openapi.js`,
`server/mcp/tools.js`, `server/mcp/server.js`, `vite.config.js`, `src/App.jsx`, `package.json`, `vercel.json`,
`.gitignore`, `knip.json` (ignore `server/generated/**` if knip flags it), `tests/unit/vercel-config.test.js`,
new `tests/unit/build-info.test.js`, new `tests/api/version.test.js`, `tests/api/mcp-coverage.test.js` (only if the
tool mapping needs it; prefer mapping `app_version: ['GET /version']`), `docs/agents/api.md`, `docs/agents/mcp.md`,
`public/llms.txt`, changelog.

1. `scripts/build-info.mjs`: export `buildInfo({ env, now, gitHead, migrations })` (pure, testable) and, when run
   as a script, write `server/generated/build-info.js` with `export default {...}` (JSON-serialised values). Rules M2.
2. `package.json`: `"build": "node scripts/build-info.mjs && vite build"`. `.gitignore`: `server/generated/`.
3. `vite.config.js`: read `server/generated/build-info.js` if present (sync `fs.readFileSync` + JSON slice, or
   dynamic import in an async config) and `define: { __BUILD_INFO__: JSON.stringify(info ?? null) }`.
4. `src/App.jsx`: replace `import.meta.env.VITE_DEPLOYED_AT` / `VITE_DEPLOY_COMMIT_SHA` with `__BUILD_INFO__`
   (declare the global for ESLint). Same output text on the tokens page.
5. `vercel.json` `buildCommand`: `node scripts/migrate.mjs && npm run build`. Update `MAIN_BUILD_COMMAND` in
   `tests/unit/vercel-config.test.js` to match.
6. `server/version.js`: `getVersion()` per M3/M4. `server/router.js`: `{ method: 'GET', path: '/version', handler }`
   with `Cache-Control: public, max-age=60`, no auth. OpenAPI entry with the schema of M4.
7. `server/mcp/tools.js`: tool `app_version` ("The version of this app: commit, deploy time, schema."), read-only
   annotations like `whoami`, `REST_ROUTES.app_version = ['GET /version']`, trigger words per `describe()` rules (EN +
   HE, `mcp-language.test.js` limits). `server/mcp/server.js`: `SERVER_INFO.version = '0.1.0+' + commit_short` when
   known.
8. Docs: `docs/agents/api.md` Discovery gets `curl -s $BASE/api/version`; `docs/agents/mcp.md` read table gets
   `app_version`; `public/llms.txt` one line.

Tests (no person): unit `buildInfo` (env sha wins over git; missing everything gives nulls; `schema` is the newest
migration; no other keys); API `GET /api/version` is 200 without a token, has exactly the five keys, `commit_short`
is 7 chars or null, no value contains `token`, `secret`, `key` or `://`; MCP `tools/call app_version` returns the
same object; `mcp-language.test.js` and `mcp-coverage.test.js` pass unchanged.

Done when: `npm run lint`, `build`, `test:unit`, `dup`, `knip`, `test:budget` pass; on the preview deployment
(`https://x-thread-draft-tool-preview.vercel.app/api/version`, Vercel fetch tool) `deployed_at` is not null and
`commit` equals the deployed sha; after merge, production deploy READY and the deployed smoke green. If
`deployed_at` is null on the preview, the generated file did not reach the function (risk 1): stop and ask Opus.

### Task 2 (M-1). Hamburger menu with Drafts, Theme, API tokens, Sign out — executor Sonnet (focus and layers), judge Opus

Visible after merge: a ☰ button at the left of every signed-in page header; it opens a left drawer with Drafts,
Theme, API tokens and apps, Sign out. The draft list header loses the Theme control and the bare "API tokens"
button. Sign-out stays in the phone bottom bar and is also in the drawer (owner question Q1, default).

Files: new `src/components/AppMenu.jsx` (button + drawer), `src/components/Icon.jsx` (add `menu` and `close`
paths), `src/components/DraftList.jsx`, `src/pages/DraftEditor.jsx`, `src/pages/TokensPage.jsx`,
`src/components/AppBar.jsx` (Q1: no change by default), `src/components/ThemeSetting.jsx` (only if a `name`/id clash appears),
`src/styles/App.css`, new `tests/unit/AppMenu.test.jsx`, `tests/unit/AppBar.test.jsx` (Q1: the bar keeps its sign-out test),
new `tests/e2e/app-menu.spec.ts`, `tests/e2e/app-bar.spec.ts` (selectors only, if the bar changes),
`tests/e2e/screens.spec.ts` (new shots `menu-open`), `docs/features/` (one section), changelog.

1. `AppMenu.jsx` per M6 to M11: state `open`; button `aria-label="Menu"`, `aria-expanded`, `aria-controls="app-menu"`;
   `createPortal(<><div className="app-menu-scrim"/><nav id="app-menu" role="dialog" aria-modal="true"
   aria-labelledby="app-menu-title" ref={panel}>...</nav></>, document.body)` only while open (no hidden DOM).
2. Effects while open: `document.getElementById('root').setAttribute('inert', '')` and remove on close;
   `document.documentElement.classList.add('menu-open')` (CSS locks scroll); focus first link; on close focus the
   button (keep a ref). `useDismiss(open, panel, setOpen)`. `useEffect(() => setOpen(false), [pathname])`.
3. Contents per M7 (no changelog, no version line yet). Links use `<Link>` and call `setOpen(false)`.
4. Place the button first in: `.draft-list-header`, `.editor-header` (before the back link), `.settings-top`.
5. Remove `<ThemeSetting />` and the "API tokens" button from `DraftList.jsx`; remove `<ThemeSetting />` from
   `TokensPage.jsx`. Q1 default: `<LogoutButton />` stays in `AppBar` (sign-out is in the bar and in the drawer), so the
   bar is unchanged on every page, including the tokens page.
6. CSS: button 40x40, `--text-strong`, focus ring `--focus`; drawer `--bg`, `--border`, shadow; vertical theme list
   inside `.app-menu .theme-segments { flex-direction: column }`; item rows 44 px high (WCAG 2.5.5 AAA).

Tests: unit (jsdom) opens on click, `aria-expanded` flips, Escape closes and focus returns to the button,
`#root` has `inert` only while open, a link click closes, route change closes, Sign out calls `authApi.logout`.
E2E `app-menu.spec.ts` (required chromium project, dev token, no person) at 390x844 and 1280x800, light and dark:
menu closed on load (`#app-menu` count 0); click opens, drawer box inside the viewport, `scrollWidth <= innerWidth`;
Tab 10 times keeps `document.activeElement` inside `#app-menu`; Escape closes and the hamburger is focused; scrim
click closes; on the editor at 390 the drawer covers the bottom bar (`elementFromPoint` at the bar's centre is in
the scrim or drawer) and after close the bar is clickable again; Theme "Dark" in the drawer sets
`data-theme="dark"`; "API tokens and apps" navigates and the menu is closed; on `/x-thread-preview/<token>` and the
signed-out `/` there is no hamburger; with `reducedMotion: 'reduce'` the drawer `transitionDuration` is `0s`.

Done when: all checks above pass; `screens` artifacts `menu-open` at 390 light/dark and 1280 linked in the PR, and
Opus answered APPROVE on them; `grep -n "ThemeSetting" src/components/DraftList.jsx` prints nothing; production
deploy READY and smoke green.

### Task 3 (M-2). API tokens page redesign, same behaviour — executor Haiku (Sonnet if it fails twice), judge Opus

Visible after merge: `/settings/tokens` shows three cards per M12; the one-time token box is clear and has one big
Copy button; empty states read well; the About line still shows at the bottom until Task 4 moves it.

Files: `src/pages/TokensPage.jsx`, `src/styles/App.css`, new `tests/unit/TokensPage.test.jsx`,
`tests/e2e/app-bar.spec.ts` (only the h1 name in the settings `ready` locator), `tests/e2e/screens.spec.ts`, changelog.

1. First commit: `TokensPage.test.jsx` against today's page, by role and text only (mock `tokensApi`,
   `grantsApi`, `navigator.clipboard`, `window.confirm`): create shows the token once and Copy writes it; a reload of
   the list does not show it again; Revoke asks `confirm` and calls `tokensApi.revoke(id)`; cancel calls nothing;
   empty lists show their empty texts; revoked tokens show no Revoke button; grant revoke flow and status text.
   It must pass on the old markup. Second commit: the redesign; the same test passes unchanged except the h1 name.
2. Reuse the existing `CopyButton` for the token box (it already has idle/copied/failed states) and delete
   `handleCopy` and `copied` state, if the test still passes (net lines go down).
3. No API, text-meaning or `confirm()` change. Cards are `<section aria-labelledby>`.

Done when: unit test passes before and after; lint/build/dup/knip pass; `screens` `tokens` at 390 and 1280, light
and dark, judged APPROVE by Opus; 390 px: `scrollWidth <= 390` (e2e assertion added to `app-menu.spec.ts`);
production READY and smoke green. Net lines expected about zero [not checked].

### Task 4 (V2). Version line at the bottom of the menu, and an About page — executor Haiku, judge Opus

Visible after merge: the drawer ends with a small line "Version a1b2c3d · deployed 2 h ago"; tapping it opens
`/about` (M16). The About line leaves the tokens page.

Files: new `src/utils/version.js` (moves the formatting out of `App.jsx`), new `src/pages/AboutPage.jsx`,
`src/App.jsx` (route `/about`, signed-in; remove the three props), `src/pages/TokensPage.jsx` (remove the About
line and props), `src/components/AppMenu.jsx`, `src/styles/App.css`, new `tests/unit/version.test.js`, new
`tests/unit/AboutPage.test.jsx`, `tests/e2e/app-menu.spec.ts`, changelog.

1. `version.js`: `formatVersion(info, now)` → `{ short, deployedAt, ago }`; `ago` uses `Intl.RelativeTimeFormat`
   (shorter than the current loop) and is "unknown" when null.
2. Drawer footer: `<Link to="/about" className="app-menu-version">Version {short} · deployed {ago}</Link>`, 12 px,
   `--text-soft` (contrast already tested in `contrast.test.js`), `title` = full UTC time.
3. `AboutPage.jsx` per M16, with the hamburger in its header; fetch `/api/version` once; loading, error ("Could not
   reach the server") and mismatch states.

Tests: unit `formatVersion` (null info, seconds, days); About renders both versions, shows the reload hint only
when commits differ (mocked fetch). E2E: at 390 and 1280 the version line is visible inside the drawer without
scrolling the drawer (`boundingBox().y + height <= innerHeight`), not covered by the bottom bar, and links to `/about`.

Done when: checks pass; `grep -n "VITE_DEPLOY\|deployedAgo" src -r` prints nothing; on production the drawer line
and `/about` show the same commit as `/api/version` (checked with a signed-in Playwright run in Actions, or the
deployed smoke if it gains a step; not by hand).

### Task 5 (C1). Changelog data: API and agents — executor Haiku, judge Opus

Visible after merge: `GET /api/changelog` returns the newest entries; MCP `app_version` also returns the 5 newest
changes. No UI yet.

Files: `scripts/build-info.mjs` (adds `changelogEntries(files)` and writes `server/generated/changelog.js`), new
`server/changelog.js`, `server/router.js`, `server/openapi.js`, `server/mcp/tools.js`, new
`tests/unit/changelog-entries.test.js` (fixtures: an old multi-section file, a new bullet file with `T6:`, a Hebrew
line, a link, a 600-char line), new `tests/api/changelog.test.js`, `docs/agents/api.md`, `docs/agents/mcp.md`,
`public/llms.txt`, changelog.

Rules M13, M14. Paging: `before` unknown → 400. Access per Q3. `REST_ROUTES.app_version` becomes
`['GET /version', 'GET /changelog']`.

Tests: parser cases above (label stripped, links reduced, Hebrew kept byte-exact and NFC, 280 cap, README skipped,
order newest first); API: default 20, `limit=1` gives `next`, following `next` gives the next one with no overlap,
`limit=51` is 400, signed-out is 401 (Q3 default); the real `docs/changelogs` parse without throwing and every
summary is non-empty (guards future file formats).

Done when: checks pass; preview `/api/changelog` (with a token, Vercel fetch tool on the preview host only) returns
the newest file of the PR's own changelog first; production READY and smoke green.

### Task 6 (C2). Changelog page in the menu — executor Haiku, judge Opus

Visible after merge: a "Changelog" item in the drawer opens `/changelog`: the running version on top, then entries
grouped by day, newest first, 20 at a time with "Show older"; About gets "See what changed".

Files: new `src/pages/ChangelogPage.jsx`, `src/App.jsx`, `src/components/AppMenu.jsx`, `src/pages/AboutPage.jsx`,
`src/utils/api.js` (`changelogApi.list({ before })`), `src/styles/App.css`, new `tests/unit/ChangelogPage.test.jsx`,
`tests/e2e/app-menu.spec.ts`, `tests/e2e/screens.spec.ts` (`changelog` shot), changelog.

Page: h1 "Changelog"; version line (M15); `<section>` per UTC day with an `<h2>` date in the user's locale; each
entry: optional bold title + summary, `dir="auto"`; loading, empty ("No changes yet."), error with "Try again".
"Show older" appends and moves focus to the first new entry.

Tests: unit grouping by day, Show older appends, error then retry. E2E at 390 and 1280: menu → Changelog loads,
at least one entry, no horizontal overflow, last entry not covered by the bottom bar after "Show older".

Done when: checks pass; `screens` `changelog` 390 light/dark and 1280 judged APPROVE; production READY.

### Task 7 (U1). "Use with AI apps" card — executor Haiku, judge Opus (epic #132 D4)

Visible after merge: under "Connect an AI app" on the tokens page, a card with the English and the Hebrew
paste-in text, each with a Copy button, and where to paste it.

Needs: epic #132 Task 2 (D2) merged, so the texts are in `docs/agents/mcp.md` [not checked: D2 state today].

Files: `src/utils/connectApps.js` (add `PASTE_IN = { en, he }`), `src/pages/TokensPage.jsx`, `src/styles/App.css`,
`tests/unit/connect-apps.test.js` (each text appears verbatim in `docs/agents/mcp.md`; the Hebrew has no U+200F;
both are NFC), `tests/unit/TokensPage.test.jsx` (two Copy buttons write the two texts), changelog, and the epic
#132 D4 row closed.

Done when: checks pass; `screens` `tokens` 390 shows the Hebrew block right-aligned and inside the screen; APPROVE.

## 5. Questions for the owner (each has a default; work does not wait)

The owner has NOT answered these questions. Every answer below is a default chosen by the agent. Shaked can change
any of them.

1. **Sign out: only in the menu, or also in the phone bottom bar?** Default: both. Shaked asked on 2026-11-14 for a
   small sign-out on every page, so sign-out stays in the phone bottom bar and is also in the menu (done in Task 2,
   `AppBar` unchanged). Opus had suggested menu only: the bar keeps page actions and Hide, and a wrong tap next to
   Publish can no longer sign out. If Shaked picks menu only, Task 2 removes `<LogoutButton />` from `AppBar`.
2. **Theme and "API tokens" leave the draft list header?** Yes: the header shows the ☰, the title and New draft.
   No: they stay as well, and the header stays crowded. Recommendation and default: yes, they move into the menu.
3. **Who can read the changelog?** Signed-in only: entries mention security fixes and internal work; agents read it
   with their token. Public: anyone can see `/api/changelog`, and a signed-out page could show it. Recommendation
   and default: signed-in only (Task 5); making it public later is a one-line change.

Decided by the planner (no question): the hamburger is at the start side of the header, which is the left because
the app is left to right; it would follow the page if the app ever became right to left (M10).

## 6. Risks

1. **The generated build-info file may not reach the Vercel function** (the function is bundled after the build
   command, and a dynamic import of a gitignored file must be traced). [not checked]. Guard: Task 1 is not merged
   until the preview shows a non-null `deployed_at`; fallback per M3 still gives the commit. If tracing fails, add
   `functions['api/handler.js'].includeFiles = 'server/generated/**'` to `vercel.json`.
2. **Drawer focus and layers:** `inert` on `#root` with a portal, scroll lock, the sticky editor header, the fixed
   bar, open Share/Export menus (both `useDismiss` listeners fire on the same Escape, which is correct), and iOS
   Safari's `100dvh`. Covered by the E2E list in Task 2; real iPhone and Safari [not checked].
3. **Changelog text quality:** 132 files in two formats, internal labels, long old entries. The parser trims, but some
   summaries will read oddly; and adding entries changes nothing until the next deploy. Guard: the real-files test in
   Task 5; future PRs keep 1 to 5 plain lines.
4. Tokens page selectors change: e2e and screens use the h1 text; Task 3 updates them in the same PR.
5. Net lines: Tasks 1, 2, 4, 5, 6 grow `src/`/`server/`; each PR names its task. Task 3 should not grow.

## 7. Not checked

- A real phone (safe area, Safari `inert` and `dvh`), Firefox and Safari rendering. Only Chromium was run.
- The new components and scripts as code: nothing here was run except today's screenshots.
- Vercel function bundling of `server/generated/*` and the Vercel clone depth.
- Epic #132 D2 state (whether the paste-in texts are already in `docs/agents/mcp.md`).
- Line counts per task (estimates).
