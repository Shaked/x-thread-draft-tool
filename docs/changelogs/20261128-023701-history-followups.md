# The restore tool now says when nothing was written
- Restoring a revision that already equals the draft says "Nothing changed", and that the version was stale if it was, instead of "Restored".
Area: Drafts
Link: https://github.com/Shaked/x-thread-draft-tool/pull/0
Screenshot: not needed, tool text and tests only

## Technical details
The restore route answers `written: false` on its no-write 200. New tests: stale version on a current revision, get_revision's retry and 409, look-alike letters outside the fold table. Note: `oneLine` still collapses whitespace in titles shown by get_revision. Implements #273 Task H7.
