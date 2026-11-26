---
name: ui-debug
description: One way to debug and work on a web UI with the right tools: run the app locally, sign in with fixtures, take screenshots at phone and desktop widths in light, dark and right-to-left, capture console and network errors, measure layout, simulate a stale tab after a deploy. Use it before any UI change or UI bug.
---

# Skill: UI debug (screenshots, errors and layout with the right tools)

Read this before you change or debug anything a person sees. Do not guess a layout from the code: look at it, measure it,
then change it, then look again. Every step below runs without a person.

## 1. Run the app locally
1. `npm ci` once, then `npm run build` (the built app, not the dev server: development mode runs effects twice and one-use links break).
2. Start the local API: `npm run dev:api` (in memory database, no real services, address `http://127.0.0.1:8787`).
3. Start the built app: `npx vite preview --host 127.0.0.1 --port 4173 --strictPort` (address `http://127.0.0.1:4173`, it proxies `/api`).
4. Rebuild after every source change: the preview serves `dist/`.
Run servers in the background and stop them when you finish. Never point these tools at a deployed site with real accounts.

## 2. Sign in with fixtures (no real secrets)
- Signed out: no cookie.
- Normal user: `POST /api/dev/session` with `{"login": "<any name>"}` answers a session cookie; `POST /api/dev/token` answers a bearer token.
- Admin: the same with `"admin": true`. Every dev admin session is the same user, and admin reads are rate limited, so keep a run small.
- Writes from a browser must carry the API's own origin: the scripts below re-send non-GET calls with it.
- Seed content through the API with that session (drafts and so on). Never print a token or commit one.

## 3. The browser
- Chromium and Playwright are pre-installed. Never run `playwright install`. `scripts/ui-shot.mjs` falls back to `/opt/pw-browsers/chromium`; set `UI_SHOT_CHROMIUM` to use another binary.
- Test runs: pass `--trace off`; use `--trace on` only to debug one failing test.
- A shot a person will see: device scale factor 2. A shot only you read: 1.

## 4. Screenshots: `scripts/ui-shot.mjs` (or `/ui-debug`)
`node scripts/ui-shot.mjs --user admin --routes /,/admin --widths 390,1280 --themes light,dark --langs en,he --scale 2 --out test-results/ui-shot`
- `--user admin|user|out` signs in as the fixture user or stays signed out. `--langs he` sets `dir=rtl` and `lang=he` on the page root; add Hebrew text through seeded content.
- Writes `<route>-<width>-<theme>-<lang>.png` and `report.json`. The exit code is 1 when a case has a problem.
- Full-page shots of a page with a fixed bar show the bar once, in the middle of the page. That is how the capture works, not a bug: look at a viewport shot to see the real screen.
- Always look at the images (Read tool). The report cannot see ugly.

## 5. Errors and failures
The script records, per route, console errors, uncaught page errors and requests that failed or answered 4xx or 5xx, and fails the case on any of them. It also fails on sideways scroll and on a blank page, and warns about touch targets under 44 px on phones.
- A request that is expected, for example a 401 while signed out, is allowed by name: `--allow "401 /api/auth/me"`. Browser lines such as "Failed to load resource" are covered by the request record, so allowing the request is enough. Never allow something to make a run green without saying why in the PR.
- Fix the cause of an error. Do not hide the message.

## 6. Audits that already run in CI
- Accessibility, 44 px targets, overflow, type, space and colour scales: `tests/e2e/ui-audit.spec.ts` (axe with WCAG 2.2 AA, no serious or critical issue). Add every new page or state to its list.
- Token lint (colours, sizes, radii only from the token file): `tests/unit/design-tokens.test.js`, run by `npm run test:unit`. Do not add a file to its legacy list.
- Screens: `npm run screens` runs `tests/e2e/screens.spec.ts` for the main flows.
- A page that talks to the API gets one test against the real local API with a real session and no fixed answers: fixed answers hide real defects.

## 7. Layout bugs: measure, do not guess
`--inspect "<css selector>"` adds each match's box (the first 20 matches) (x, y, width, height) and computed `display`, `position`, `overflow-x`, `padding-inline`, `margin-inline`, `gap`, `font-size`, `color`, `background-color`, `text-align` to `report.json`. Look for:
- overflow: `document.documentElement.scrollWidth` above `clientWidth`; find the widest child by box;
- doubled gutters: a parent and a child both add padding or margin;
- hidden or clipped elements: `display: none`, zero size, `overflow: hidden` on an ancestor, a box outside the screen;
- right-to-left: logical properties (`padding-inline`, `margin-inline`, `text-align: start`) instead of left and right.
For more, write a short Playwright script and use `page.evaluate` with `getBoundingClientRect` and `getComputedStyle`.

## 8. Stale tab after a deploy
After a deploy, an open tab still asks for script files of the old build. Those files are gone, and a host that rewrites unknown paths to the page answers `200 text/html`. The dynamic import fails. A page without an error boundary goes blank.
`node scripts/ui-shot.mjs --routes /<lazy route> --stale-chunk` loads the entry, answers every later script file with the page, then moves to the route. The browser's own module-load errors are expected in this mode and are not counted. Pass means a visible message or alert and a reload button; a blank page fails.

## 9. Before and after, and what goes in the PR
- Take "before" shots first: `--out docs/screenshots/<task>/before`. After the fix: `--out docs/screenshots/<task>/after`. Same routes, widths, themes and languages.
- Attach to the PR: the after shots for each width (phone and desktop, light and dark, and right-to-left when text direction matters), the one-line result of `report.json` (cases, failures, warnings), and the command you ran. Link the images from the PR text; `report.json` and trace files are ignored by git.
- Any text you post (PR, issue comment, handoff) uses the `reply-style` skill and passes `npm run reply-lint`.
- Keep the number of committed images small: the changed pages only.

## 10. Checklist
1. Built the app, started the API and the preview.
2. Before shots and report taken.
3. Fix made with tokens and shared components, not one-off values.
4. After shots and report: no failures, warnings explained, images looked at.
5. A test added where a test can catch it (ui-audit list, a real-API spec, a unit test).
6. `npm run precommit:checks` passes.
