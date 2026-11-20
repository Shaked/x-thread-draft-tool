# Offline MCP tool-discovery score (English and Hebrew)
- New `tests/eval/discovery/` scores which tool each of 13 intents' English and Hebrew phrases would pick, offline and deterministic, with floors in `baseline.json`; `tests/api/mcp-discovery.test.js` fails on any drop.
- `clients.json` records what each AI app shows; only Claude's interactive views are sourced, every other fact is "not checked".
- No product code changed. Method and rules: `docs/architecture/mcp-discovery.md`.
