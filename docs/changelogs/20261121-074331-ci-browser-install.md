# CI: browser install without apt fonts (speed S1, #309)

- E2E job and `ui-image-upload.yml` install Chromium with `npx playwright install chromium` (no `--with-deps`); the `screens` job keeps `--with-deps`.
- Playwright browser cache key is the installed Playwright version, not the lockfile hash.
- E2E job uploads `test-results/screens` as artifact `e2e-screens`.
