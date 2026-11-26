# Weekly review checks dependencies and client facts every week

- Once a week the repository checks outdated packages, security advisories, and client-matrix rows that have not been checked for over 30 days. It opens one issue only when something changed.

Area: Docs
Link: https://github.com/Shaked/x-thread-draft-tool/pull/468

## Technical details

Task #295 of epic #273: `.github/workflows/weekly-review.yml`, `scripts/weekly-review-check.mjs` (signals, fingerprint, plan), Telegram kind `weekly-started`, unit tests, `docs/operations/weekly-review.md`, `docs/operations/telegram.md`.
