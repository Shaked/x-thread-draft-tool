# Migrate from Supabase to Vercel + Neon + Vercel Blob

- Added `api/handler.js` and `server/`: one Vercel Function serving auth, drafts, images, and one-time share links under `/api`.
- Replaced Supabase Auth with GitHub OAuth + signed `xt_session` cookie; replaced RLS with owner-scoped SQL.
- Replaced Supabase Postgres with Neon (`pg`); schema in `db/migrations/001_init.sql`, applied by `scripts/migrate.mjs` at build time.
- Replaced Supabase Storage with Vercel Blob (4 MB per image).
- Removed `@supabase/supabase-js`, `supabase/`, `keep-supabase-alive.yml` and `supabase-deploy.yml`.
- Added `scripts/migrate-from-supabase.mjs` and `data-migrate.yml` (dry run by default; not run yet).
- Added API tests (`npm run test:api`) and a destructive-SQL lint in CI.
- Updated README, SETUP, architecture, feature and ops docs.
