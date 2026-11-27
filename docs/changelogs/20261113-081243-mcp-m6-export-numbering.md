# AI apps can export numbered threads

- A draft can be exported as numbered text, the same as the numbered copy in the app.
- The same numbered text is available through the API and the AI app tools.

Area: Editor
Link: https://github.com/Shaked/x-thread-draft-tool/pull/86

## Technical details

- Export numbering: GET /api/drafts/:id/export?format=text&numbered=true and export_draft numbered=true give the UI's "Copy (Numbered)" output; the UI and REST share exportAsNumberedText.
- Why: agents could not get the numbered thread the UI offers. Plan: docs/plans/mcp-clients.md (step M6).
