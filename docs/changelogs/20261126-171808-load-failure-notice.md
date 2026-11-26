# A Reload notice replaces a blank page

- After a new version is out, a page or part that cannot load shows a Reload button instead of an empty screen.

Area: Admin
Link: https://github.com/Shaked/x-thread-draft-tool/pull/555

## Technical details

`src/ui/LoadBoundary.jsx` wraps every `React.lazy` part. The admin area shows a notice and Reload; the Rare UI parts fall back
to the current components. Tests: `tests/e2e/load-failure.spec.ts` and `tests/unit/LoadBoundary.test.jsx` (#551).
