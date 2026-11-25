# The changelog page groups entries by area

- On the changelog page, each day's changes are grouped by area, and each change links to its pull request.
- Older changes stay under "Earlier changes", and their full text opens in a fold.

Area: Admin
Link: https://github.com/Shaked/x-thread-draft-tool/pull/429

## Technical details

Step 1 of plan #369 (old changelog entries). Adds the Area and Link lines and the Technical details part to the template,
the lint (scripts/reply-lint.mjs), the build (scripts/build-info.mjs) and the page. CI checks added entries
(.github/workflows/changelog-check.yml); existing entries may not change until the batch rewrites (steps 2 to 6).
