# A check that AI apps save drafts

- A new optional check asks a model to handle written threads and questions, and tests that it saves threads as drafts and does not save when only answering.
- It does not run in the automatic checks, and it skips itself without an API key.

Area: AI apps
Link: https://github.com/Shaked/x-thread-draft-tool/pull/145

## Technical details

- Added an optional evaluation, tests/eval/mcp-default-use.eval.mjs, that checks with the Anthropic API whether a model saves written threads as drafts and answers questions without saving (epic #132 D3). It is not run in CI and skips without ANTHROPIC_API_KEY.
