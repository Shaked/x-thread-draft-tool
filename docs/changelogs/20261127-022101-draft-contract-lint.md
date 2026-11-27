# AI apps get a checked contract for editing drafts

- A test now checks the wording AI apps are given for drafts: edit first, short answers, options as quotes, Hebrew kept as written.
- Every draft result is checked for its one-line status and for stray code blocks; a new eval prints the same check as a table.

Area: AI apps
Link: https://github.com/Shaked/x-thread-draft-tool/pull/583

## Technical details

`tests/api/draft-contract.test.js` (new) runs the contract lint on the server text and on one seeded draft. `npm run eval:contract` runs the score table and `tests/eval/contract/format.mjs`; the pre-commit hook runs it only when a contract file is staged. Owner reports for ChatGPT and Grok are recorded in `tests/eval/discovery/clients.json` with their issue links, values unchanged. `docs/architecture/client-matrix.md` and `docs/agents/mcp.md` are updated. Discovery score and `baseline.json` unchanged.
