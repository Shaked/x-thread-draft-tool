# Post-migration hardening: decisions and task breakdown

- Re-measured the baseline in `docs/plans/post-migration-hardening.md`: the 3 critical audit findings are dev-only (vitest); production has 4 high (Blob → oidc → zod chain); 10 of 14 test files exceed 3 s in CI because of per-file PGlite startup; CI runs the API tests twice.
- Recorded decisions: automated review blocks on high/critical; audit findings are fixed first (Task 0). Agent auth proposed as a remote MCP connector with OAuth on Vercel, pending confirmation.
- Added section E: light theme by default and a friendlier UI, starting with design tokens.
- Broke the plan into ordered Tasks 0–7 with acceptance checks. Updated `docs/plans/index.md` and `docs/plans/current.md`.
- Added Task 1.0: fix the automatic deployed smoke test (token chosen by deployment environment; public-only mode for per-branch previews).
