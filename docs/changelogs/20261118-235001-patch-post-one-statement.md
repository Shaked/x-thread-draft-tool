# Post updates use one database write

- Updating a post now writes in one statement instead of a 4-statement transaction.
- The post update tool for AI apps takes 3 queries instead of 6.
- Answers, statuses and headers stay as they were.

Area: Speed
Link: https://github.com/Shaked/x-thread-draft-tool/pull/150

## Technical details

PATCH /api/drafts/:id/posts/:postId now writes in one SQL statement instead of a 4-statement transaction (plan P7).
Answers, statuses and headers are unchanged. Query budget: MCP update_post 6 to 3.
