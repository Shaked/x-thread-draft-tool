## What is over
Speed: 1 in 10 merges took 3 min 38 s or more from push to tested production. Limit 2 min 30 s.

## The numbers
- Now: 218 s (read from the summary at 2026-11-26 06:00 UTC, checked)
- Limit: 150 s
- Last week: 170 s
- Over since: 2026-11-24 14:10 UTC, 7 merges

## Likely cause
slow setup step: the step "Install packages" took 95 s in 3 runs, against 20 s usually.

## What was done
Opened this issue. Nothing else yet.
No limit was changed.

## Notes
- [Summary](https://sample-app.example.com/admin/metrics)
- [Slowest run](https://github.com/acme/sample-app/actions/runs/12)
