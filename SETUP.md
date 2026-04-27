# Setup Guide

This guide will help you deploy your own instance of the X Thread Draft Tool using Vercel and Supabase.

## Prerequisites

- GitHub account
- Basic familiarity with Git

## Step 1: Fork Repository

1. Fork this repository to your GitHub account
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/x-thread-draft-tool
   cd x-thread-draft-tool
   ```

## Step 2: Create Supabase Project

1. Go to [supabase.com](https://supabase.com)
2. Click "New Project"
3. Fill in project details (free tier is sufficient)
4. Wait for project to be created (~2 minutes)

## Step 3: Setup Database

1. In Supabase Dashboard, go to **SQL Editor**
2. Copy the contents of `supabase/schema.sql` from this repo
3. Paste into SQL Editor and click **Run**
4. You should see "Success" message

## Step 4: Create Storage Bucket

1. In Supabase Dashboard, go to **Storage**
2. Click "New bucket"
3. Name: `draft-images`
4. Make it **Public**
5. Click "Create bucket"

## Step 5: Enable GitHub Authentication

1. Create a GitHub OAuth App:
   - Go to GitHub Settings → Developer settings → OAuth Apps
   - Click "New OAuth App"
   - **Application name**: X Thread Draft Tool
   - **Homepage URL**: Your app URL (you'll update this later)
   - **Authorization callback URL**: `https://YOUR_PROJECT.supabase.co/auth/v1/callback`
   - Copy the **Client ID** and **Client Secret**

2. In Supabase Dashboard, go to **Authentication** → **Providers**
3. Enable **GitHub**
4. Paste your Client ID and Client Secret
5. Click "Save"

## Step 6: Deploy to Vercel

1. Go to [vercel.com](https://vercel.com)
2. Click "Add New" → "Project"
3. Import your forked repository
4. Vercel will auto-detect Vite
5. Add environment variables:
   - `VITE_SUPABASE_URL`: Found in Supabase Dashboard → Settings → API → Project URL
   - `VITE_SUPABASE_ANON_KEY`: Found in Supabase Dashboard → Settings → API → Project API keys → anon public
6. Click "Deploy"
7. Wait for deployment (~2 minutes)

## Step 6.5: Configure GitHub Actions secrets (optional, recommended)

The repo ships two workflows that talk to your Supabase project:

- `keep-supabase-alive.yml` — runs daily and calls a `keepalive()` RPC so the project doesn't get auto-paused after a week of inactivity. Hitting `/rest/v1/` does **not** count as activity (it's a cached OpenAPI response, no SQL is executed); the RPC runs `select now();` so PostgREST issues a real query.
- `supabase-deploy.yml` — on push to `main`, pushes new SQL migrations from `supabase/migrations/` and deploys the `share` edge function. Includes a lint that blocks `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `DELETE FROM`, and `ALTER ... DROP` so it can't accidentally destroy data.

In your GitHub repo settings → Secrets and variables → Actions, add:

| Secret | Where to find it |
| --- | --- |
| `SUPABASE_URL` | Supabase Dashboard → Settings → API → Project URL |
| `SUPABASE_SECRET_KEY` | Supabase Dashboard → Settings → API Keys → secret key (starts with `sb_secret_…`) |
| `SUPABASE_ACCESS_TOKEN` | https://supabase.com/dashboard/account/tokens (generate one) |
| `SUPABASE_PROJECT_ID` | Project ref shown in Settings → General → Reference ID |
| `SUPABASE_DB_PASSWORD` | The database password you set when creating the project |

After secrets are set, run **Actions → Deploy Supabase migrations and functions → Run workflow** once to apply the initial migration and deploy the `share` edge function. From then on, pushes to `main` that touch `supabase/**` deploy automatically.

## Step 7: Update GitHub OAuth Callback

1. Go back to your GitHub OAuth App settings
2. Update **Homepage URL** to your Vercel deployment URL (e.g., `https://your-app.vercel.app`)
3. Save changes

## Step 8: Test Your App

1. Visit your Vercel deployment URL
2. Click "Sign in with GitHub"
3. Authorize the app
4. Start creating thread drafts!

## Local Development

To run locally:

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create `.env.local` file:
   ```
   VITE_SUPABASE_URL=your_supabase_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

3. Run development server:
   ```bash
   npm run dev
   ```

4. Open http://localhost:5173

## Troubleshooting

### Login doesn't work
- Check that GitHub OAuth callback URL matches your deployment URL
- Verify Supabase environment variables are correct

### Images won't upload
- Ensure `draft-images` bucket is public
- Check browser console for errors

### Drafts not saving
- Verify database schema was applied correctly
- Check Supabase logs in Dashboard

## Support

If you encounter issues, please:
1. Check browser console for errors
2. Review Supabase logs
3. Open an issue on GitHub

## Cost

Both Vercel and Supabase offer generous free tiers:
- **Vercel**: Free for personal projects
- **Supabase**: 500MB database, 1GB storage, 50K monthly active users - all free

You should be able to run this app entirely for free unless you have thousands of users.
