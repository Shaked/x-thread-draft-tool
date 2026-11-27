# The weekly task check now actually runs

- The weekly check of the task list was skipped by mistake, and now runs.
- No change for people using the app.

Area: Docs
Link: https://github.com/Shaked/x-thread-draft-tool/issues/461
Screenshot: not needed, no visible change

## Technical details

In `janitor-weekly.yml`, `contains()` on the off-switch list matched an unset variable (null is coerced to 0, equal to "0"). The condition now compares with `!= 'off'` and `!= 'false'`. The test evaluates it with GitHub's rules (`tests/unit/helpers/gh-expression.js`). Task-janitor 0.1.2 also cuts title words by code point.
