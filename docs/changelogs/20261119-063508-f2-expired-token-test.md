# F2 (#162): expired-token test also checks no rate row

- The expired-token case in `tests/api/mcp-rate.test.js` now also asserts that no rate-limit row is written for that user (test only, no product code change).
