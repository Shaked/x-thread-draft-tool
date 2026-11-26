# Metrics count MCP calls by app

- The metrics now show MCP calls by app: Claude, ChatGPT, the command line, or other apps.
- Nothing about a client is stored beyond its app name.

Area: AI apps
Link: https://github.com/Shaked/x-thread-draft-tool/pull/477

## Technical details

`server/mcp/rate.js` joins `oauth_clients` in the token check (still one statement) and returns `family` from `server/metrics/client-family.js`; `server/metrics/record.js` takes the five `mcp:*` callers in place of `mcp`. Tests: `tests/unit/client-family.test.js`, `tests/api/metrics-record.test.js`.
