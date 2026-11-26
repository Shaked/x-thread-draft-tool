# The admin metrics page shows delivery and CI

- The admin metrics page has a "Delivery and CI" section: CI time (median and p90), push to production, deploy time, CI failures and flaky retries, each with last week's value.
- It lists the newest delivery events with a link to each, has a 24 hours and 7 days switch, and links to older history.

Area: Admin
Link: https://github.com/Shaked/x-thread-draft-tool/issues/452

## Technical details

Central metrics M6 (#452), decisions D3 and D5: `src/pages/admin/DeliverySection.jsx` reads `GET /api/admin/metrics/summary` and `/events`. The CI finding of the summary gains `ci` (median, p90, flaky retries and their last-week values). Capabilities UI cells set.
