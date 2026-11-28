# CI/CD Notes

## Local
- Pre-commit hook runs `npm run precommit:checks`.
- `precommit:checks` runs lint + unit tests.

## Build and migrations
- `vercel.json` build command: `node scripts/migrate.mjs && vite build`. Migrations run on every Vercel build (Production and Preview each use their own Neon database).
- `scripts/migrate.mjs` warns and skips when `DATABASE_URL_UNPOOLED` is not set, so local builds still work. `npm run db:migrate` runs it with `--strict`, which fails instead.
- Migrations are additive only; the `unit` job in CI fails on destructive SQL in `db/migrations/`.

## GitHub Actions
- `.github/workflows/tests.yml`: the `checks` job lints migrations and runs the static checks; the unit and API tests run in four `Unit tests shard n/4` jobs (`npm run test:budget -- --shard=n/4`, split by `tests/shard-assignment.json`, see `docs/operations/shard-timings.md`); the `unit` job (`Unit tests (vitest)`, the required check) fails unless all of them passed. E2E is the default gate. The `chromium` Playwright project starts the local API (`npm run dev:api`, port 8787) and the built app (`vite preview`, port 4173) itself, unless `XT_BASE_URL` points at a deployment. On a laptop an already running preview on port 4173 is reused, so stop it first to test a fresh build.
- `.github/workflows/supabase-backup.yml`: manual, encrypted backup of Supabase (pre-migration). Kept until Supabase is deleted.
- `.github/workflows/data-migrate.yml`: manual copy of Supabase data into Neon and Blob. Dry run unless `apply` is set.
- Removed: `keep-supabase-alive.yml` (Neon Free does not pause) and `supabase-deploy.yml`.

## Speed metrics
- `scripts/speed-metrics.mjs` measures the four stages of `docs/plans/speed.md` section 1 (CI, merge wait, Vercel, smoke) from the GitHub API only. It writes `speed.json` and `speed.md`; the job summary shows `speed.md`.
- Manual run: Actions, "Speed metrics", "Run workflow", input `last` (default 50). It prints the p90 table to the job log, sends one Telegram line when a stage's p90 is over its limit, and keeps the artifact `speed-metrics` for 90 days.
- Per merge: after each production `Smoke test (deployed)` run, the same workflow measures that merge and writes one `::warning::` per stage over its limit. It never fails the run.
- Local: `GITHUB_TOKEN=<read token> GITHUB_REPOSITORY=Shaked/x-thread-draft-tool node scripts/speed-metrics.mjs --last 50`. The token needs read access only.

## Request timing (`[perf]`)
Every API request logs one line `[perf] {...}` on the function's log and sends a `server-timing` header. The line has `m` (method), `p` (the route template, such as `/drafts/:id`, or `unmatched`; never a real path, id, token, header, body or query), `s` (status), `ms` (total time), `q` (SQL round trips), `db` (ms spent in SQL and connecting), `conn` (new connections opened), `cold` (1 for the first request of a function instance), `region` (`VERCEL_REGION`, the region the function ran in), and for MCP, `rpc` and `tool`. To read it in production, use the Vercel log search for `[perf]` over the last 30 minutes. A high `conn` with `cold` 0 means the pool reconnected after an idle period, and `db` close to `ms` means the database is the slow part. `npm run smoke` prints a `TIME` line per step with the client time and the server header.
