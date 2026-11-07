# CI/CD Notes

## Local
- Pre-commit hook runs `npm run precommit:checks`.
- `precommit:checks` runs lint + unit tests.

## Build and migrations
- `vercel.json` build command: `node scripts/migrate.mjs && vite build`. Migrations run on every Vercel build (Production and Preview each use their own Neon database).
- `scripts/migrate.mjs` warns and skips when `DATABASE_URL_UNPOOLED` is not set, so local builds still work. `npm run db:migrate` runs it with `--strict`, which fails instead.
- Migrations are additive only; the `unit` job in CI fails on destructive SQL in `db/migrations/`.

## GitHub Actions
- `.github/workflows/tests.yml`: the `unit` job lints migrations, then runs `npm run test:unit` and `npm run test:api`. E2E is the default gate.
- `.github/workflows/supabase-backup.yml`: manual, encrypted backup of Supabase (pre-migration). Kept until Supabase is deleted.
- `.github/workflows/data-migrate.yml`: manual copy of Supabase data into Neon and Blob. Dry run unless `apply` is set.
- Removed: `keep-supabase-alive.yml` (Neon Free does not pause) and `supabase-deploy.yml`.
