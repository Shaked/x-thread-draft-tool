# Character counts follow the X rules

- Counts and the save limit now follow X rules: a link counts as 23, an emoji as 2, and direction marks as 2.
- This applies in the editor, the splitter, draft summaries and post edits from the API and AI apps.

Area: Editor
Link: https://github.com/Shaked/x-thread-draft-tool/pull/130

## Technical details

- T6: post counts and the save limit follow the X rules (URL 23, emoji 2, bidi marks 2) in the editor, the splitter, the split API, draft summaries and PATCH/MCP post text.
