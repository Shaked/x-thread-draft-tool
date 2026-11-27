# The weekly task check no longer repeats outsiders' text

- Words from issue titles are cleaned before the weekly check posts them, so nobody can be pinged by a title.
- No change for people using the app.

Area: Docs
Link: https://github.com/Shaked/x-thread-draft-tool/pull/612

## Technical details

`safeWord` in the task-janitor plugin (0.1.1) drops `@`, markup and URLs from title words. The weekly workflow now also runs on its schedule (the branch check skipped it) and its off switch ignores case.
