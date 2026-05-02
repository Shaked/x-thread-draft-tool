# X Thread Draft Tool — Claude guide

## Performance metrics & iOS reload diagnostics

This project collects production performance metrics specifically to diagnose
and reduce iOS Safari's automatic page reloads (caused by device-side memory
eviction, not server load). When the user asks about performance, slowness,
"why does iOS keep refreshing", bundle size, or wants to optimize the app,
**run the diagnostic tools first** before guessing.

### How to access metrics (Claude, do this in order)

1. **WebFetch the metrics endpoint**:
   `https://<supabase-project-ref>.supabase.co/functions/v1/metrics?viewableOnlyWith=<METRICS_TOKEN>`
   Optional `&period=24h|7d|30d` (default `7d`), `&format=md|json` (default
   `md`). The response is a Markdown report with sections for
   volume/eviction rate, Web Vitals percentiles, heap/DOM at hide-time, and
   long-task hotspots.
2. **Where to find the token**:
   - If `.env.local` exists and contains `METRICS_TOKEN=...`, use that (read
     with user permission).
   - Otherwise ask the user once: "Paste the metrics token (set via
     `supabase secrets set METRICS_TOKEN=...`)". Remember it for the session.
   - Do not commit the token anywhere or echo it back to the user in plain
     text after they share it.
3. **For historical comparison**, call the endpoint twice with different
   `period=` values and diff in your head. The response includes a
   "current vs prior period" delta row already.
4. **Bundle composition** is local-only: run `npm run bundle:report` (no
   creds needed). Run `npm run analyze` if a regression appears. Skip both
   if running in a sandbox without `node_modules`.

### Stealth 404 — important

Without the token, or with a wrong token/wrong method/invalid period, the
endpoint returns `404 Not Found` indistinguishable from a non-existent route.
This is intentional. If you hit a 404, double-check the token before
assuming the function isn't deployed.

### What the metrics mean

- `payload.likelyEvicted = true` on a pageview ⇒ the page was reloaded after
  iOS likely evicted it (cold reload, last visibility was hidden, gap > 30 s).
  This is the headline metric to drive down.
- "Heap & DOM at last hide before eviction" ⇒ what the page looked like the
  moment iOS decided whether to keep it. High values here correlate with
  high eviction rate — these are the levers.
- p75 INP > 200 ms or p75 LCP > 2.5 s ⇒ Core Web Vitals failure.
- `share` Edge Function timing lives in Supabase function logs (filter for
  JSON lines `{"evt":"share","ms":...}`), not in the metrics table.

### What to optimize when eviction rate is high

In rough order of impact for iOS reload reduction:
1. **Initial JS bundle size.** Run `npm run analyze`. The PWA install adds
   stricter memory limits than a regular tab — every KB matters.
2. **DOM node count on long-lived screens.** `DraftEditor` is the suspect.
3. **Long-lived `URL.createObjectURL` blobs in `ImageUpload.jsx`** —
   confirm they're revoked when no longer displayed.
4. **Service-worker cache size** (`navigator.storage.estimate()` in
   metrics). Large origin storage correlates with iOS purging the whole
   origin.
5. **Image dimensions / format** — large images stay resident in memory.

Server CPU/RAM is **not** the cause of iOS reloads. It only affects TTFB.
Ignore unless cold-start spikes show up in the share function timing logs.

### Files

- Collector: `src/utils/metrics.js` (initialized from `src/main.jsx`).
- Schema: `supabase/migrations/20260502000000_metrics_events.sql` and
  `supabase/migrations/20260502000001_metrics_views.sql` (the latter also
  defines the `metrics_summary(interval)` function).
- Metrics endpoint: `supabase/functions/metrics/index.ts`.
- Share function timing log: `supabase/functions/share/index.ts`.
- Local diagnostic scripts: `scripts/metrics-*.mjs`,
  `scripts/bundle-report.mjs`.
- Performance budget baseline: `bundle-baseline.json`.

### Kill switch (for users)

If a user reports privacy concerns or perf regressions caused by the
collector itself: tell them to set `localStorage['mx:off']='1'` in their
browser, or append `?metrics=0` to a URL. Both disable collection without
a deploy.

### Token rotation

If the metrics token is ever exposed:
```
supabase secrets set METRICS_TOKEN="<new-long-random>" --project-ref <ref>
```
Old token stops working immediately. No code change needed. Update
`.env.local` to match.

### Adding new metrics

1. Add the collection in `src/utils/metrics.js`.
2. Send it as a new `event_type` or new field in an existing `payload`.
3. Add or update a view in a new migration; do not edit existing migrations.
4. If it should appear in the report, add a section to `metrics_summary()`
   in a new migration and a render block in
   `supabase/functions/metrics/index.ts`.

The schema is intentionally `jsonb`-heavy so adding fields needs no
migration.

### Privacy

- The `/metrics` endpoint returns aggregates only. No `session_id`s, no
  `user_id`s, no `user_agent` strings, no full `url_path`s with IDs.
- The `metrics_events` table itself is not readable via PostgREST (no
  SELECT policy). Only the service role can read it.
- The collector strips IDs from `url_path` before sending (UUIDs become
  `[id]`).
- The `?metrics=0` URL flag and `localStorage['mx:off']='1'` both opt out
  immediately, no deploy.
