# Setup Guide

This guide deploys your own copy of the X Thread Draft Tool on Vercel, with Neon for the database, Vercel Blob for images, and a GitHub OAuth App for sign-in. The app is free to run on the Hobby, Neon Free and Blob free tiers.

## Prerequisites

- GitHub account
- Vercel account (Hobby is fine for personal use)
- Basic familiarity with Git

## Step 1: Fork and clone

1. Fork this repository to your GitHub account.
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/x-thread-draft-tool
   cd x-thread-draft-tool
   ```

## Step 2: Create the Vercel project

1. On [vercel.com](https://vercel.com), click **Add New** → **Project** and import your fork.
2. Vercel detects Vite. Keep the defaults (the build command and rewrites come from `vercel.json`).
3. Do not deploy yet. First add the database and storage in Step 3.

## Step 3: Add Neon and Blob from the Vercel Marketplace

1. In your Vercel project, open **Storage**.
2. Create a **Neon** database (Free plan) and connect it to Production, Preview and Development.
   This sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED`.
3. Create a **Blob** store (set it to **public**) and connect it to all environments.
   This sets `BLOB_READ_WRITE_TOKEN`.

## Step 4: Create a GitHub OAuth App

Create one OAuth App for production and, if you want previews to sign in, a second one for the preview domain.

1. GitHub → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**.
2. Production app:
   - **Homepage URL**: `https://YOUR-APP.vercel.app`
   - **Authorization callback URL**: `https://YOUR-APP.vercel.app/api/auth/callback`
3. Copy the **Client ID** and generate a **Client secret**.

## Step 5: Set environment variables

In Vercel → **Settings** → **Environment Variables**, add these for **Production** (and **Preview** if you use it):

| Name | Value |
| --- | --- |
| `GITHUB_CLIENT_ID` | OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | OAuth App client secret |
| `SESSION_SECRET` | 32+ random bytes, e.g. `openssl rand -base64 48` |
| `PUBLIC_APP_URL` | `https://YOUR-APP.vercel.app` (no trailing slash) |

Use a different `SESSION_SECRET` and `PUBLIC_APP_URL` for Preview, where `PUBLIC_APP_URL` is the preview domain.
Sign-in only works on the origin set in `PUBLIC_APP_URL`, so use the same domain you open in the browser.

## Step 6: Deploy

Trigger a deployment (Vercel → **Deployments** → **Redeploy**, or push to your branch).

The build runs `scripts/migrate.mjs` before `vite build`. It applies the SQL in `db/migrations/` to the Neon database. Migrations are additive and recorded in `schema_migrations`, so every deploy is safe to repeat.

## Step 7: Test your app

1. Open `https://YOUR-APP.vercel.app/api/health`. It should show `{"ok":true}`.
2. Open the app and click **Sign in with GitHub**.
3. Create a draft, add an image, publish it, and generate an **X Thread** link.

## Local development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Run the front end:
   ```bash
   npm run dev
   ```
3. To run the API locally, use `vercel dev` after linking the project, or point a local Neon branch at `DATABASE_URL`. `npm run test:api` needs neither: it runs the API against an in-process Postgres.

## GitHub Actions (optional)

| Workflow | What it does |
| --- | --- |
| `tests.yml` | Lints `db/migrations` for destructive SQL, then runs unit and API tests, then E2E. |
| `supabase-backup.yml` | Manual, encrypted backup of the old Supabase project. Only needed during the one-time migration. |
| `data-migrate.yml` | Manual copy of Supabase data into Neon and Blob. Dry run by default. |

Secrets used by the migration workflows (repo → **Settings** → **Secrets and variables** → **Actions**):

| Secret | Used by |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD` | Backup and data migration (to find the Supabase database) |
| `SUPABASE_URL` | Backup (to download images) |
| `DATABASE_URL_UNPOOLED` | Data migration (production Neon direct connection) |
| `BLOB_READ_WRITE_TOKEN` | Data migration (uploads images to Blob) |
| `BACKUP_PASSPHRASE` | Backup encryption |

## Troubleshooting

### Sign-in fails or returns to the home page
- `PUBLIC_APP_URL` must match the domain in your browser exactly.
- The OAuth callback URL must be `PUBLIC_APP_URL/api/auth/callback`.

### Save or share actions return 403 "Cross-origin request blocked"
- Open the app on the domain set in `PUBLIC_APP_URL`; other origins are refused for writes.

### Images won't upload
- Check that the Blob store is connected and `BLOB_READ_WRITE_TOKEN` is set.
- Images must be 4 MB or smaller after compression.

### Build fails in the migration step
- Check that `DATABASE_URL_UNPOOLED` is set for the environment. Locally, the build warns and skips migrations when it is missing.

## Cost

- **Vercel Hobby**: free, for non-commercial use
- **Neon Free** and **Vercel Blob free tier**: free within their quotas
