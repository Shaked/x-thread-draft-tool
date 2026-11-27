Remote image fetch now follows up to 3 redirects. Every hop re-checks the URL rules, re-resolves DNS, refuses private addresses and uses a pinned connection. All hops share one 10 s limit.
