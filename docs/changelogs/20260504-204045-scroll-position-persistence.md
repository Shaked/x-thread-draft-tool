# 2026-05-04 — Scroll position persistence across iOS PWA reloads

## What changed
- New `src/utils/scrollRestoration.js` persists per-pathname scroll position
  and the last visited location in both `sessionStorage` and `localStorage`
  (TTL 6h), with a retry loop for restoring scroll while async content
  hydrates.
- New `src/components/ScrollRestoration.jsx` is mounted inside
  `<BrowserRouter>` in `src/App.jsx`. It:
  - Saves scroll on route changes, `pagehide`, `visibilitychange`, and
    `beforeunload`.
  - Restores scroll on route mount and on `pageshow` (handles BFCache and
    full reloads).
  - On a one-shot, in-session basis, redirects from `/` to the last deep
    location when the iOS PWA cold-launches at `start_url` after being
    killed for memory.
- `DraftList` persists the active tab (`drafts` / `published`) to
  `localStorage` so returning users land on the same tab.

## Why
PRs #16 and #18 stopped service-worker-driven auto-reloads but did not
preserve scroll/location when iOS Safari and PWAs discard or relaunch the
page on tab/app switches. Standalone PWAs in particular jump back to the
manifest's `start_url`, dropping the user out of any deep route. This
change covers all three failure modes (BFCache restore, full Safari reload,
PWA cold launch from `start_url`).

## Cross-agent compliance
- Added root `AGENTS.md` so Codex/GPT picks up the same rules Claude
  reads from `claude.md`.
- `claude.md` updated to state these rules apply to every agent.

## Testing
- New unit tests in `tests/unit/scrollRestoration.test.js` cover storage
  round-trip, TTL expiry, redirect guard, and the retry loop.
- `npm run lint` (vite build) and `npm run test:unit` pass locally.
- Manual smoke: `npm run dev` and verified scroll restoration on
  `/draft/:id` after switching tabs.

## Docs touched
- `docs/features/sync-and-offline.md` — note scroll/location persistence.
- `claude.md` — explicit cross-agent applicability.
- `AGENTS.md` — new pointer file.
