# Architecture Overview

## Runtime
- Frontend: React + Vite SPA.
- Data/auth/storage: Supabase.
- Hosting: Vercel.

## Core domains
- Draft composition and local editing.
- Draft persistence + sync.
- Sharing/export pipelines (including one-time preview links).
- Publish/archive lifecycle.

## Testing model
- Fast local checks: build + unit tests.
- Full path checks: E2E in GitHub Actions.
