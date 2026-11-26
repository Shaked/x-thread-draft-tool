# Agents can read the metrics summary and act on it

- The `metrics` plugin has a second skill, `metrics-read-act`: read the summary, find what is a problem, name one cause, open an issue with the numbers.
- It never changes a limit and never skips a test.

Area: Docs
Link: https://github.com/Shaked/x-thread-draft-tool/issues/453

## Technical details

Central metrics M8 (#453), part 2. Plugin `metrics` 0.2.0: the skill, `templates/finding-issue.md`, `scripts/finding-check.mjs`, golden fixtures and tests.
