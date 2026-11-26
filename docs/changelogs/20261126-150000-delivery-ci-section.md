# The admin metrics page shows delivery and CI

- The admin metrics page has a "Delivery and CI" section.
- It shows CI time (median and p90), push to production, deploy time, CI failures and flaky retries.
- Each number has last week's value next to it.
- It lists the newest delivery events with a link each, and has a 24 hours and 7 days switch.

Area: Admin
Link: https://github.com/Shaked/x-thread-draft-tool/issues/452

## Technical details

Central metrics M6 (#452), decisions D3 and D5: `src/pages/admin/DeliverySection.jsx` reads `GET /api/admin/metrics/summary` and `/events`. The CI finding of the summary gains `ci` (median, p90, flaky retries and their last-week values). Capabilities UI cells set.
