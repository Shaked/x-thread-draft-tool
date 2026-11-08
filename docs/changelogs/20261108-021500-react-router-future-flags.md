# React Router v7 future flags (plan Task 0.3b, step 1)

- Opts `BrowserRouter` in `src/App.jsx` into `v7_startTransition` and `v7_relativeSplatPath` on `react-router-dom` 6.30.6, before the v7 bump in PR #34.
- No other flags apply: the app has no data router, loaders, actions, fetchers or `<Form>`.
- The only splat route is `path="*"` with an absolute `<Navigate to="/" replace />`, so relative splat resolution does not change.
- No dependency change. `npm run build` and `npm run test:unit` pass.
