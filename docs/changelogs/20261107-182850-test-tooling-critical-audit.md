# Test tooling: clear critical audit findings

- Upgraded vitest and @vitest/ui to 3.2.7 (vitest@latest needs vite 6, this repo is on vite 5).
- Pinned jsdom to ^29.1.1 (jsdom 31 needs Node 22.22+; CI runs Node 20).
- Overrode tinypool to ^2.2.0 to clear its critical advisory. Outside vitest 3 range (^1.1.1); removed in Task 0.3a.
- npm audit critical: 3 -> 0. Unit tests: 152 passing on Node 20.
