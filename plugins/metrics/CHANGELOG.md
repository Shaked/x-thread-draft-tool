# Changelog

## 0.2.0

- The `metrics-read-act` skill: read the summary in plain lines, what counts as a problem, find one cause, open an issue with the numbers, report. It never changes a limit.
- A finding-issue template and `scripts/finding-check.mjs` with golden fixtures (2 good, 4 bad).

## 0.1.0

- The `metrics-emit` skill: how a repository joins a central metrics service, the event shape (version 1) and its caps, what never goes in, the rollup pattern, the dry run.
- `scripts/metrics-config.mjs` reads the `metrics` section of `.claude/agent-kit.json`: `app`, `repo`, `siteUrl`, `ingestUrl`.
