# Test tooling: clear critical audit findings

- Upgraded vitest to 3.2.7 and @vitest/ui to 3.2.7, jsdom to 31 (plan Task 0.1).
- Overrode tinypool to 2.2.0 to clear its critical advisory.
- npm audit critical: 3 -> 0. Unit and API tests: 152 passing.
