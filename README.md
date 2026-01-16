# X Thread Draft Tool

A modern web app for composing, managing, and exporting Twitter/X threads with cloud sync, image uploads, and shareable draft links.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/x-thread-draft-tool&env=VITE_SUPABASE_URL,VITE_SUPABASE_ANON_KEY)

## Features

### Composition
- **Multi-post threads** - Compose threads with unlimited posts
- **Rich content** - Add up to 4 images per post
- **Emoji picker** - Insert emojis directly into posts
- **Tweet embeds** - Embed existing tweets in your thread
- **Character counter** - Real-time 280-character limit tracking
- **Thread numbering** - Automatic post numbering (1/n format)

### Storage & Sync
- **Cloud sync** - Auto-save drafts to Supabase
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
- **Backend**: Supabase (PostgreSQL + Auth + Storage)
- **Deployment**: Vercel
- **Styling**: Custom CSS
- **PWA**: vite-plugin-pwa

## Quick Start

### Option 1: Deploy to Vercel (Recommended)

1. Click the "Deploy with Vercel" button above
2. Follow [SETUP.md](./SETUP.md) for complete instructions
3. You'll need:
   - Supabase account (free)
   - GitHub account (for OAuth)

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

3. Create `.env.local`:
   ```
   VITE_SUPABASE_URL=your_supabase_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

4. Run development server:
   ```bash
   npm run dev
   ```

5. Open http://localhost:5173

## Project Structure

```
.
├── supabase/
│   └── schema.sql         # Database schema
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
│   │   ├── supabase.js    # Supabase client
│   │   └── ...
│   ├── styles/
│   │   └── App.css        # Styles
│   └── App.jsx            # Router setup
├── vercel.json            # Vercel configuration
└── vite.config.js         # Vite + PWA config
```

## Database Schema

The app uses three main tables in Supabase:

### `drafts`
- `id` - UUID (primary key)
- `user_id` - UUID (foreign key to auth.users)
- `title` - Text
- `posts` - JSONB (array of post objects)
- `is_published` - Boolean
- `published_at` - Timestamp
- `created_at` - Timestamp
- `updated_at` - Timestamp

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
- Automatic compression (max 1920px width)
- 5MB per image limit
- 4 images per post max
- Stored in Supabase Storage

## Environment Variables

### Required

- `VITE_SUPABASE_URL` - Your Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Your Supabase anon/public key

### Setup

See [SETUP.md](./SETUP.md) for detailed setup instructions.

## Cost

The app can run entirely for free:

- **Vercel**: Free for personal projects
- **Supabase Free Tier**:
  - 500MB database
  - 1GB storage
  - 50K monthly active users

Unless you have thousands of users, you'll stay within free limits.

## Contributing

Contributions are welcome! Please open an issue or PR.

## License

MIT

## Credits

Built with React, Supabase, and Vercel.
