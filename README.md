# X Thread Draft Tool

A modern web app for composing, managing, and exporting Twitter/X threads with cloud sync, image uploads, and shareable draft links.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/x-thread-draft-tool&env=GITHUB_CLIENT_ID,GITHUB_CLIENT_SECRET,SESSION_SECRET,PUBLIC_APP_URL)

## Features

### Composition
- **Multi-post threads** - Compose threads with unlimited posts
- **Rich content** - Add up to 4 images per post
- **Emoji picker** - Insert emojis directly into posts
- **Tweet embeds** - Embed existing tweets in your thread
- **Character counter** - Real-time 280-character limit tracking
- **Thread numbering** - Automatic post numbering (1/n format)

### Storage & Sync
- **Cloud sync** - Auto-save drafts to Neon Postgres via the app's API
- **Offline editing** - Continue editing without internet (IndexedDB)
- **Conflict resolution** - Latest timestamp wins on sync
- **Published archive** - Mark drafts as published to archive them

### Sharing & Export
- **Shareable links** - Anyone with the link can view drafts (read-only)
- **JSON export** - Download drafts for backup
- **Markdown export** - Export threads with formatting
- **Copy to clipboard** - With or without numbering

### User Experience
- **PWA support** - Install as mobile app
- **Mobile responsive** - Works on all devices
- **GitHub OAuth** - Simple authentication
- **Draft management** - List, edit, and delete drafts

## Tech Stack

- **Frontend**: React 18 + Vite
- **API**: one Vercel Function (`api/handler.js`) under `/api`
- **Database**: Neon Postgres (`pg`)
- **Images**: Vercel Blob
- **Auth**: GitHub OAuth App + signed session cookie (`jose`)
- **Deployment**: Vercel
- **Styling**: Custom CSS
- **PWA**: vite-plugin-pwa

## Quick Start

### Option 1: Deploy to Vercel (Recommended)

1. Click the "Deploy with Vercel" button above
2. Follow [SETUP.md](./SETUP.md) for complete instructions
3. You'll need:
   - Neon database and Vercel Blob store (both free, added from the Vercel Marketplace)
   - A GitHub OAuth App

### Option 2: Local Development

1. Clone the repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/x-thread-draft-tool
   cd x-thread-draft-tool
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create `.env.local` with the variables from [Environment Variables](#environment-variables).
   The API needs a Neon database and a `SESSION_SECRET`; the front end talks to `/api` on the same origin.

4. Run the front end:
   ```bash
   npm run dev
   ```

5. Open http://localhost:5173

Tests run without any external service: `npm run test:unit` (React and helper tests) and `npm run test:api` (API routes against an in-process Postgres, PGlite).

## API & agents

Every feature of the app is also available as a JSON API under `/api`, with the same
permissions as your GitHub account. Create a personal token at `/settings/tokens` (or get one
with GitHub's device flow via `npm run agent:login`), then use `Authorization: Bearer xt_...`.

- Discovery: [`/llms.txt`](./public/llms.txt) and [`/api/openapi.json`](./server/openapi.js)
- Agent guide with curl examples: [docs/agents/api.md](./docs/agents/api.md)
- Local API for development and tests: `npm run dev:api` (http://127.0.0.1:8787), then `npm run smoke`

## Project Structure

```
.
├── api/
│   └── handler.js         # The one Vercel Function; delegates to server/router.js
├── server/
│   ├── router.js          # Path/method dispatch, CSRF origin check, error mapping
│   ├── routes/            # auth.js, drafts.js, images.js, share.js
│   ├── share/render.js    # One-time share page + markdown renderers (pure JS)
│   ├── db.js              # Lazy pg pool (max 1 connection per function instance)
│   ├── session.js         # HS256 JWT session cookie
│   └── blob.js            # Vercel Blob put/delete wrappers
├── db/
│   └── migrations/        # Additive SQL, applied at build time by scripts/migrate.mjs
├── tests/
│   ├── unit/              # Vitest + Testing Library
│   ├── api/               # API route tests (PGlite)
│   └── e2e/               # Playwright
├── src/
│   ├── components/        # React components
│   │   ├── PostBox.jsx    # Individual post editor
│   │   ├── EmojiPicker.jsx
│   │   ├── ImageUpload.jsx
│   │   ├── TweetEmbed.jsx
│   │   ├── LoginPage.jsx
│   │   ├── DraftList.jsx
│   │   └── ...
│   ├── pages/
│   │   └── DraftEditor.jsx # Main editing page
│   ├── utils/
│   │   ├── api.js         # Same-origin client for /api
│   │   ├── images.js      # Image upload helpers
│   │   └── ...
│   ├── styles/
│   │   └── App.css        # Styles
│   └── App.jsx            # Router setup
├── vercel.json            # Vercel configuration
└── vite.config.js         # Vite + PWA config
```

## Database Schema

The app uses three tables in Neon Postgres (see `db/migrations/001_init.sql`):

### `users`
- `id` - UUID (primary key); users migrated from Supabase keep their original UUID
- `github_id` - Unique GitHub account id (users are matched on this at sign-in)
- `login`, `name`, `avatar_url` - Profile fields from GitHub

### `drafts`
- `id` - UUID (primary key)
- `user_id` - UUID (foreign key to users)
- `title` - Text
- `posts` - JSONB (array of post objects)
- `is_published` - Boolean
- `published_at` - Timestamp
- `created_at` - Timestamp
- `updated_at` - Timestamp

### `share_tokens`
- `token` - UUID (primary key); one-time share link
- `draft_id`, `created_by` - Draft and owner
- `used`, `used_at` - Set atomically on first use

### Post Object Structure
```json
{
  "id": "uuid",
  "text": "Post content",
  "images": ["url1", "url2"],
  "embeddedTweet": "https://x.com/user/status/123"
}
```

## Features in Detail

### Shareable Links

Each draft has a unique URL (`/draft/:id`) that can be shared. Anyone with the link can view the draft, but only the owner can edit it.


### One-time X-thread preview links

The **X Thread** button generates a one-time-use share token and copies a URL like:

`https://<your-app-domain>/x-thread-preview/<token>`

Why this shape: some edge gateway/CDN paths force `.html` URLs to `text/plain` regardless of response headers. The app route fetches the one-time HTML payload from `/api/share/<token>?format=html` and writes it into the document, avoiding `text/html` rewrite behavior on direct navigation.

Behavior:
- First successful open consumes the token and renders the styled HTML thread preview.
- Any later open returns an expired/invalid response (`410 Gone`).
- Agent links copy `/api/share/<token>.md` (markdown). The same link works once.

### Published Feature

Mark a draft as "published" to:
- Move it to the Published tab
- Delete all uploaded images (to save storage)
- Archive the draft (read-only for owner too)

### Offline Support

The app works offline using:
- Service Worker (PWA)
- IndexedDB for draft caching
- Auto-sync when back online

### Image Upload

- Drag & drop or click to upload
- Automatic compression (max 1600px width)
- 4MB per image limit (uploads are checked by the API)
- 4 images per post max
- Stored in Vercel Blob (public URLs with random suffixes); images are deleted when a draft is published or deleted

## Environment Variables

### Vercel (set by integrations)

- `DATABASE_URL` - Neon pooled connection string (used by the API)
- `DATABASE_URL_UNPOOLED` - Neon direct connection string (used by migrations at build time)
- `BLOB_READ_WRITE_TOKEN` - Vercel Blob store token

### Vercel (set by you, per environment)

- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` - GitHub OAuth App credentials
- `SESSION_SECRET` - 32+ random bytes, e.g. `openssl rand -base64 48`
- `PUBLIC_APP_URL` - Public origin of the deployment, no trailing slash

### Setup

See [SETUP.md](./SETUP.md) for detailed setup instructions.

## Cost

The app can run entirely for free:

- **Vercel Hobby**: Free for personal, non-commercial projects
- **Neon Free**: Free Postgres database
- **Vercel Blob Free**: Free storage quota

Images are deleted on publish, so storage stays small. Free-tier limits stop the service when exceeded; they do not bill.

## Contributing

Contributions are welcome! Please open an issue or PR.

### Documentation update policy

When a task changes behavior, contributors should update:
- `docs/plans/current.md`
- `docs/features/*.md`
- `README.md` (if user-facing behavior/setup changed)
- a new timestamped changelog file under `docs/changelogs/` (`YYYYMMDD-HHMMSS-<slug>.md`)

## License

MIT

## Credits

Built with React, Vercel, Neon, and Vercel Blob.
