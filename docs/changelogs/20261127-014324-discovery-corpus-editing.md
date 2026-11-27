# Discovery check now covers editing a draft

- The offline tool-discovery check has 6 new intents (hook, reorder, add, remove, split, options) and 4 new questions, in English and Hebrew, so it can measure the "no tool call on update" problem. No tool text changed.

Area: MCP
Link: https://github.com/Shaked/x-thread-draft-tool/pull/0

## Technical details

`tests/eval/discovery/intents.json` (19 intents, 8 negatives per language), `baseline.json` (floors for the new rows; 50 new `top3` known failures, "added by Task 2; tool text fixed in #279"), pinned counts in `tests/api/mcp-discovery.test.js`, `docs/architecture/mcp-discovery.md`. Implements #386.
