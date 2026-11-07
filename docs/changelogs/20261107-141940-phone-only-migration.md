# Phone-only migration prep

- Added manual `.github/workflows/supabase-backup.yml`: encrypted DB + users + images backup, with the drafts schema and row counts in the run summary.
- `docs/plans/vercel-migration.md`: Phase 0 rewritten for phone-only setup; data migration now runs as a GitHub Actions workflow (`data-migrate.yml`, written by the executor).
