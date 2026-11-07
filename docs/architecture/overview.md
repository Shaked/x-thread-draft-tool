# Architecture Overview

## Runtime
- Frontend: React + Vite SPA.
- API: one Vercel Function at `/api` (`api/handler.js`, router in `server/`).
- Database: Neon Postgres via `pg`; schema in `db/migrations/`, applied at build time.
- Images: Vercel Blob (public URLs).
- Auth: GitHub OAuth App; signed HS256 session cookie (`xt_session`).
- Hosting: Vercel (Hobby).

## Core domains
- Draft composition and local editing.
- Draft persistence + sync.
- Sharing/export pipelines (including one-time preview links).
- Publish/archive lifecycle.

## Testing model
- Fast local checks: build + unit tests.
- API checks: `npm run test:api` (routes against in-process Postgres, PGlite).
- Full path checks: E2E in GitHub Actions.
