# Metrics daily: the ops events collector

Central metrics plan M3 (#439, task #449). `.github/workflows/metrics-daily.yml` runs `scripts/ops-emit.mjs` every 6 hours (and by hand, on `main` only). The script reads the GitHub API and posts one batch per listed repo to `POST /api/ops/events` (M2), with the workflow's OIDC token for the `x-thread-draft-tool-ops-events-production` audience.

## What it reads
- CI runs of the listed workflows (`server/ops/sources.js`): one event per completed run, keyed by run id and attempt.
- Merges into `main`, their Production and Preview deployments, and (for `speed: true` repos) the speed stages of each merge, through the functions of `scripts/speed-metrics.mjs`.
- Counters for each finished UTC day: runs that are not stored events (skipped, cancelled, unlisted, stuck).

## Limits and what they mean
- **Re-runs: 3 days.** Each run lists the runs created since the start of the UTC day three days ago. A re-run that starts more than 3 days after its run is not collected. Its earlier attempt, if stored, stays.
- **Runs still going** are not stored until they complete. A run still going after 24 hours is counted as `stuck` in its day's counters, and the cursor never falls more than 24 hours behind the newest stored run.
- **The list filter is the creation time.** Whether the list-runs API can also filter by completion time: not checked. The 3-day window covers a run that completes later either way.
- **Rate limit:** the script stops once fewer than 100 API calls remain (`x-ratelimit-remaining` of the last answer). It posts the events it has. Counters and the cursor are sent when the run listing and the CI events completed, even if it stopped among the merges; otherwise neither is sent, and the next run repeats the window.
- **Speed rows wait.** A merge gets its speed rows only 2 hours after it merged, and only when every run on its head and merge commit has finished. A run that never finishes (stuck, or waiting for an approval) means that merge never gets speed rows. Its CI, merge and deploy events are still stored.
- **A listing that is cut short** (a day answering fewer runs than its total_count) sends no counters and no cursor; the next run repeats the window.
- Events stay 14 days and counters 400 days (the route's rules, `server/ops/events.js` and `server/ops/ingest.js`).

## Run it by hand
- Dry run, nothing sent: `node scripts/ops-emit.mjs --dry-run --repo Shaked/x-thread-draft-tool` with `GITHUB_TOKEN` set to a read token.
- A real run: Actions, Metrics daily, Run workflow (`main` only). The log shows `ops-emit: <repo> events=… counters=… complete=… accepted=… refused=…`.
