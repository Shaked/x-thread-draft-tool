# Image operations in the discovery corpus (#414, #273 Task C5)

- Added three intents to `tests/eval/discovery/intents.json`: replace an image, move an image, remove all images of a post (4 English and 4 Hebrew phrases each).
- The new phrases that miss the top 3 and the admin-pool hits are recorded in `baseline.json` as known failures with their reasons; the stale admin entry for "Fix the wording of the last post" is removed.
- Tool descriptions are unchanged: every wording tried for the three tools moved an existing top-1/top-3 cell or a margin by more than 0.01, so #414 stays open for the description work.
