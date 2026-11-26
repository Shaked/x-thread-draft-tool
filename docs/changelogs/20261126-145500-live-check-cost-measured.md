# The cost of the live draft check is now measured

- The docs now list what one open editor tab costs in database time, transfer and compute hours.

Area: Docs
Link: https://github.com/Shaked/x-thread-draft-tool/pull/0

## Technical details

`docs/architecture/draft-sync.md`, section "Cost per open editor tab". Local measurement with dev-api, read-only reads of the Neon project and the Vercel and Neon docs. Not measured on production or preview: see the doc. Implements #474 Task 3.
