# Draft updates use one database query

- Updating a draft now takes 1 database query instead of 4.
- Adding a post takes 4 queries instead of 7, and moving or removing a post takes 4 instead of 7.
- Answers, statuses and headers stay as they were.

Area: Speed
Link: https://github.com/Shaked/x-thread-draft-tool/pull/149

## Technical details

PATCH /api/drafts/:id now writes in one SQL statement instead of a 4-statement transaction (plan P6).
Answers, statuses and headers are unchanged. Query budget: PATCH 4 to 1, add_post 7 to 4, move_post and remove_post 7 to 4, remove_post with image 9 to 6.
