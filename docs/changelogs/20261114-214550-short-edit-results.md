# Edit tools in AI apps return short results

- After an edit, the post and draft tools in AI apps return the draft outline and version instead of the whole draft.
- Only the get draft tool returns post text.
- API responses stay as they were.

Area: AI apps
Link: https://github.com/Shaked/x-thread-draft-tool/pull/129

## Technical details

# Short results from post edit tools (T5)

- MCP `add_post`, `update_post`, `move_post`, `remove_post`, `remove_image`, `add_image_from_url`, `create_draft`, `update_draft`, `duplicate_draft` and `create_thread_from_text` return the draft outline and its `version` instead of the full draft; `get_draft` is the only tool that returns post text.
- REST responses are unchanged.
