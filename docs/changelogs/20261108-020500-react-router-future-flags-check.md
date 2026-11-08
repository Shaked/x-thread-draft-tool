# React Router v7 future flags: retroactive check (plan Task 0.3b, step 1)

Plan step 1 says "future flags first, then the version bump". PR #34 went straight to the bump.
This records the flags step, done after the fact on `react-router-dom` 6.30.6.

- `BrowserRouter` in `src/App.jsx` is the only router. The app uses no data router, loaders,
  actions, fetchers or `<Form>`, so `v7_fetcherPersist`, `v7_normalizeFormMethod`,
  `v7_partialHydration` and `v7_skipActionErrorRevalidation` do not apply.
- Checked the two flags that do apply, `v7_startTransition` and `v7_relativeSplatPath`, on 6.30.6:
  `npm run build` and `npm run test:unit` (194 tests) pass with both set. The only splat route is
  `path="*"` with an absolute `<Navigate to="/" replace />`, so relative splat resolution does not change.
- `react-router-dom` 7.18.5 has no `v7_*` flags (they are the default behavior), so nothing is added to
  `src/App.jsx` on top of PR #34. No source change.
