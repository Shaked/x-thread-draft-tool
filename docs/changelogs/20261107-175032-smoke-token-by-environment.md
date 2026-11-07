# Deployed smoke test: token and scope by Vercel environment

- Task 1.0 of `docs/plans/post-migration-hardening.md`. The automatic smoke run failed on every deployment since the migration merge (401 on the account steps).
- `.github/workflows/smoke-deployed.yml`: Production deployments use `XT_SMOKE_TOKEN_PRODUCTION` (chosen by `deployment.environment`, not the canonical URL); Preview deployments run the public steps only; manual runs unchanged.
- `scripts/smoke.mjs`: new `XT_SMOKE_PUBLIC=1` mode; account steps print SKIP.
- Documented in `docs/agents/api.md`.
