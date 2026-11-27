# AI app tool calls need one query less

- The token check and the tool-call count for AI apps now run as one query.
- Each tool call takes one query less.
- A request without a token is still refused before its body is read.

Area: Speed
Link: https://github.com/Shaked/x-thread-draft-tool/pull/151

## Technical details

MCP auth and the tools/call count are one SQL statement (plan P4). A valid tools/call of a known tool is counted in the same query that checks the token; other requests run only the token check.
Answers, statuses, headers and error texts are unchanged; a request without a bearer token still gets 401 without reading its body. Query budget: each tools/call is 1 fewer (list_drafts and get_draft 2, add_post and move_post 3, update_post 2, remove_post 3, or 5 with an image).
