# Faster tests for the metrics tables

- The check that the metrics migration can run twice no longer starts a second database, so the test run is about 2 seconds shorter.
- This clears the red test run on the main branch caused by the time budget.

Area: Speed
Link: https://github.com/Shaked/x-thread-draft-tool/pull/459
