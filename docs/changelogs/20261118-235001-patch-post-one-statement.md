PATCH /api/drafts/:id/posts/:postId now writes in one SQL statement instead of a 4-statement transaction (plan P7).
Answers, statuses and headers are unchanged. Query budget: MCP update_post 6 to 3.
