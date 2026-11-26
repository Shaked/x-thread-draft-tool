# Rate-limit test no longer depends on the clock

- A test of the 120 calls per minute limit failed by chance when its calls crossed a minute boundary. It now runs on a fixed clock.

Area: Admin
Link: https://github.com/Shaked/x-thread-draft-tool/pull/531
