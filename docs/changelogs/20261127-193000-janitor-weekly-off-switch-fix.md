# The weekly task check now actually runs

- The weekly check of the task list was skipped by mistake, and now runs.
- No change for people using the app.

Area: Docs
Link: https://github.com/Shaked/x-thread-draft-tool/issues/461
Screenshot: not needed, no visible change

## Technical details

In `janitor-weekly.yml`, `contains()` on the off-switch list matched an unset variable (loosely equal to "0"). The condition now compares with `!= 'off'` and `!= 'false'`. Test: `tests/unit/janitor-weekly-workflow.test.js`.
