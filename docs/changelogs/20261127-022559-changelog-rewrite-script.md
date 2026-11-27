# Old changelog entries can be rewritten in reviewed batches

- A script rewrites old entries from a batch file. It shows a dry run first and writes nothing until asked.
- Each rewritten entry keeps its original text under "Technical details".

Area: Docs
Link: https://github.com/Shaked/x-thread-draft-tool/pull/582

## Technical details

Step 2 of plan #369: `scripts/changelog-rewrite.mjs` (dry run, `--write`, `--check`) and `scripts/changelog-check.mjs` (allows a change to an existing entry only through a passing batch).
