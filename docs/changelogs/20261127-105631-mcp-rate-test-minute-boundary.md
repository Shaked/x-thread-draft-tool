# Fix flaky mcp-rate test at a minute boundary

- The test read the count for the current minute after the call; if the minute changed in between, it read no row. It now reads the newest count row, which is the one the call wrote.
- The assertions are unchanged (120 and 121 calls).

Area: tests
Link: https://github.com/Shaked/x-thread-draft-tool/issues/594
