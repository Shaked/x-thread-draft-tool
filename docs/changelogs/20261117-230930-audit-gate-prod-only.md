# Dependency audit checks only production packages for now

- The dependency audit that must pass before a merge covers production packages only, because a development-only package has a known issue with no fix yet.
- The full audit still runs on every change and only reports. It must pass again by 2026-12-17, once that package is patched.

Area: Security
Link: https://github.com/Shaked/x-thread-draft-tool/pull/134

## Technical details

# Temporary: CI audit gate covers production dependencies only
Why: dev-only picomatch ReDoS GHSA-fc5q-39xc-vjpf has no patch on npm. Owner decision 2026-11-17 (option A). Full gate returns by 2026-12-17 once picomatch is patched.
