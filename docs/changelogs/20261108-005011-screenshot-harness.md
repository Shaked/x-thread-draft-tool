# Screenshot harness (plan Task 6.0)

- Adds `tests/e2e/screens.spec.ts`: captures login, drafts-empty, drafts-three, editor, preview, share and tokens at 390 px and 1280 px into `test-results/screens/<width>/<name>.png` (7 per width). Signed-in pages use a dev API token sent as a bearer header.
- Adds a `screens` project to `playwright.config.ts`. The `chromium` project ignores the screens spec, so `npm run test:e2e` does not run it. Script `npm run screens`.
- Adds a manual `screens` job to `tests.yml` (`workflow_dispatch` only). It builds the app, serves it on port 4173, starts the local API and uploads the PNGs as an artifact.
- The harness runs against the built app, not `npm run dev`: in development React StrictMode runs the preview effect twice, and the second request gets 410 on the one-use share link.
- Known gap: the seeded image URL (`/pwa-192x192.png`) is not in `public/`, so the editor and preview screenshots show a broken image. Fix in a later change with a real image fixture.
