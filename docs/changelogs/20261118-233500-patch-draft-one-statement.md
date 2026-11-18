PATCH /api/drafts/:id now writes in one SQL statement instead of a 4-statement transaction (plan P6).
Answers, statuses and headers are unchanged. Query budget: PATCH 4 to 1, add_post 7 to 4, move_post and remove_post 7 to 4, remove_post with image 9 to 6.
