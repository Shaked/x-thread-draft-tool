# Sync and Offline

- Supabase-backed draft persistence.
- Offline editing support with local persistence.
- Conflict resolution based on latest update timestamp.
- Scroll position and last-visited route are persisted across tab/app
  switches and iOS PWA cold launches (see
  `src/components/ScrollRestoration.jsx` and
  `src/utils/scrollRestoration.js`). On standalone PWA relaunch at the
  manifest `start_url`, the app one-shot redirects to the most recent
  deep location if it is fresh (TTL 6h).
- `DraftList` persists the active tab (`drafts` / `published`) so users
  return to the same view.
