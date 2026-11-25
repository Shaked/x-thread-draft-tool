# Draft revisions and encryption (E273 task H1, plan)

Planner: Opus 5.5, 2026-11-21. Issue: #366. Epic: #273. **Plan only. Nothing here is built yet.**

Owner request (Shaked, 2026-11-21): every draft has revisions, you can go back to one, and a save stores
the diff, not the whole draft. Everything saved is encrypted, and the user must see that the owner,
even as admin, cannot read what they saved.

**Short answer.**
- Revisions: store **one row per changed post** (option b). A normal save then costs about 0.65 KB
  instead of about 3.5 KB for a 7-post draft. Restore is one query. A diff is "post 3 changed",
  "post 5 added after post 4", "posts moved", plus a word-level diff inside a changed post.
- Encryption: "encrypted" and "the owner cannot read it" are two different promises. **Only
  encryption in the user's browser, with a key the server never has, can truthfully support "the owner
  cannot read it".** That costs a lot for AI apps: an AI app can then add text to a draft but can no
  longer read it, shorten it, review it or show it. So the recommendation is an opt-in **locked
  draft**: locked drafts get the strong promise and lose AI reading; normal drafts keep working with AI
  apps and get a weaker, honest promise.
- The owner decides four things (section 7). If nobody answers, nothing is built.

Checked means I read it in the code or a source on 2026-11-21. "Not checked" means I did not.

## 1. Today's facts

### How a draft is stored (checked: `db/migrations/*.sql`, `server/routes/drafts.js`)
- Table `drafts`: `id`, `user_id`, `title` (text; the column has no limit, the routes check at most 500 characters, and duplicate adds
  " (copy)" past that), `posts` (jsonb array),
  `is_published`, `published_at`, `created_at`, `updated_at`, `version`.
- A post is a JSON object: `{ id, text, images, embeddedTweet }`. `id` is a string, usually a UUID
  (`server/mcp/tools.js` `withPostIds`). `images` holds URLs (strings or `{ url }`). `embeddedTweet` is
  a tweet URL or null.
- **User text lives in:** `drafts.title`, each post's `text`, each post's `embeddedTweet` URL, the
  image files in Vercel Blob (`drafts/<user id>/<draft id>/<random>.<ext>`), and the image URLs.
  Also `users.name`, `users.login` (from GitHub, not draft text).
- `drafts.version` (migration 005): an integer that every write increases by one. It is only a
  counter for "did someone else write since I read?" (`If-Match`, answer 412 with the current draft,
  PR #359). It is not a history: nothing old is kept today. An overwritten post is gone, except in
  Neon's own history (6 hours, below).
- Images: uploaded with `access: 'public'` (`server/blob.js` `putBlob`). **Anyone who has an image URL
  can open the image**, without signing in. The URL has a random part, so it is hard to guess.

### Sizes (from the limits in the code, not measured on real data)
- `PATCH /drafts/:id/posts/:postId` allows text of at most 280 characters as X counts them, and at most
  4,000 JavaScript characters (`patchPostText`). A URL counts 23 whatever its length, so a post can be
  long in bytes.
- `PATCH /drafts/:id` and `POST /drafts` **do not check post text length or post count** (`validPosts`
  only checks that each post has a string id). The only limit is the 1,000,000-byte request body
  (`server/http.js` `readJson`). So the hard limit of one draft is about 1 MB.
- Bytes of one full post (280 X characters): English about 280 B, Hebrew about 560 B (2 bytes per
  letter), at most about 840 B for other weight-1 scripts; plus about 70 B of JSON. **Typical post:
  about 500 B. Typical 7-post draft: about 3.5 KB.** Real average and p95: not checked (I did not
  query production).
- Free Neon storage: 1 GB per project (checked in `docs/plans/observability.md`, from
  https://neon.com/docs/introduction/plans). Used today: not checked (the observability plan reads it
  by hand with `pg_database_size()`; I did not run it). Neon keeps 21,600 s (6 hours) of history on
  our project (`history_retention_seconds`, observability plan, checked).

### Every place that reads draft text (checked by reading the code)
| Place | What it returns |
|---|---|
| `GET /drafts` | full drafts with posts (the home list); `view=summary` gives counts only |
| `GET /drafts/:id`, `PATCH ...`, 412 answers | the full draft |
| `GET /drafts/:id/outline` | counts and **the first 40 characters of each post** (`server/draft-stats.js`) |
| `GET /drafts/:id/export` | the text in JSON or plain text |
| `POST /drafts/:id/duplicate` | reads the draft into JavaScript and inserts a copy with new post ids |
| `GET /share/:token[.md|.html]` | **public**: the text and images to anyone with a live link |
| MCP `get_draft`, `list_drafts detail=full`, `export_draft` | the text, to the AI app |
| MCP write tools | the outline (40-character previews) and `x-thread/posts` (full posts) in `_meta` for the thread view |
| MCP prompts (`tighten_draft`, `review_before_publish`, `rewrite_hook`) | ask the AI app to read the draft |
| Editor `/draft/:id` and home `/` | the text in the browser; nothing kept in `localStorage` (only theme and bar preference) |
| Admin (`server/admin/queries.js`, `server/routes/admin.js`) | **counts only**: drafts, posts, images, image file count and bytes. No title, no text, no image URL (the SQL never selects them) |
| Admin delete (`server/admin/delete-user.js`) | reads nothing; deletes the files, then the rows |
| Logs | `[perf]` logs method, route, status, timings, tool name: no text. `console.error` logs errors in `server/router.js`, `server/mcp/tools.js`, `server/mcp/server.js`,
`server/blob.js`, `server/admin/delete-user.js`, `server/routes/admin.js` and `server/oauth/tokens.js`: an error object could hold text (for example a database error detail). Not proven either way: the leak scan test (task H10) checks it |
| Error reports | none: no Sentry or similar (checked: no such package or call) |
| Backups | Neon: 6 hours of history the owner can restore from; Neon's own backups in object storage, "retained for 30 days" (Neon security page, below). Neon preview branches: each preview deployment can get its own branch, and the stable preview is never deleted (`docs/agents/api.md`, checked); whether a branch starts as a copy of production data: not checked. Vercel Blob backups: not checked |
| The person who runs the app | the Neon console, the database connection string, the Blob token and the Vercel project settings: **all text and images, in plain form** |
| AI apps | everything the tools return goes to the AI app's company (OpenAI, Anthropic, xAI). Out of our control |

## 2. Revisions

### 2.1 What a revision is
One revision is **one logical change by one actor**:
- the user in the editor (autosave bursts from the same user within 2 minutes are merged into one
  revision, so typing does not create hundreds);
- one AI app (named by its OAuth client name, for example "ChatGPT"; a personal API token is shown as
  "API token", never its user-given name); tool calls of the same app within 2 minutes merge too;
- a restore ("Restored revision 9");
- the system ("Published", "Before history started").
Two different actors are never merged, so you can always go back to just before an AI change.

Each revision stores: `seq` (1, 2, 3 per draft), the draft `version` after it, `created_at`,
`actor_kind` (`user`, `app`, `restore`, `system`), `actor_name`, a short `label`, the title only if it
changed, the post order only if it changed, and one row for each post whose content changed.

`version` stays what it is (the `If-Match` counter from #354). A revision records the `version` it
produced, as #354's handoff asked.

### 2.2 Storage design: three options

| | (a) full snapshot per revision | (b) **per-post snapshots** | (c) text diffs inside a post plus a snapshot every 50 |
|---|---|---|---|
| Normal save (1 of 7 posts changed) | ~3.5 KB | ~0.65 KB (0.5 KB post + ~0.15 KB header) | ~0.27 KB (diff ~0.1 KB + header + 1/50 of a snapshot) |
| 1,000 saves of a 7-post draft | ~3.5 MB | **~0.65 MB** | ~0.27 MB |
| AI rewrites all 7 posts | ~3.5 KB | ~3.6 KB | ~3.6 KB (diffs are as big as the text) |
| Restore | read 1 row | 1 query: the newest version of each post at or before `seq` | read the snapshot and replay up to 49 diffs |
| Complexity | low | medium | high (diff format, replay, snapshot schedule, repair) |
| Works with encrypted posts | yes | **yes: the unit is the encrypted post** | no: you cannot diff ciphertext; the server cannot compact |
| How to show it | compare two snapshots | same, by post id | same, after rebuilding both states |

Sizes are before Postgres compression (Postgres TOAST may compress large values; its threshold and the effect here: not checked).

**Recommendation: (b).** It is 5 times smaller than (a) for normal edits, restore is one query, and it is
the only option that still works when posts are encrypted (section 3). (c) saves another 0.4 MB per
1,000 saves, which is not worth the replay code and does not work with encryption.

With the recommended retention (section 2.5, at most 300 revisions per draft) one draft's history is at
most about 0.2 MB in normal use and about 1 MB if an AI rewrites everything 300 times.

### 2.3 Schema (recommended, task H2)
```
draft_revisions(draft_id → drafts on delete cascade, seq int, version int, created_at,
                actor_kind text, actor_name text, label text,
                title text null,          -- only when the title changed
                post_order text[] null,   -- only when posts were added, removed or moved
                primary key (draft_id, seq))
draft_post_versions(draft_id → drafts on delete cascade, post_id text, seq int,
                    body jsonb null,      -- the whole post object; null means "removed"
                    primary key (draft_id, post_id, seq))
drafts: + last_actor_kind, last_actor_name, last_label (set by each write; read by the trigger)
```
- **A database trigger writes the revision**, inside the same `UPDATE` or `INSERT`: it compares `OLD`
  and `NEW` posts by id. Every writer (editor, REST, MCP, restore, publish) gets history with no extra
  round trip, and no future route can forget it. The query count per request stays the same
  (`tests/api/query-budget.test.js`).
- The merge rule (same actor within 2 minutes, no label) updates the last revision in place instead of
  adding one.
- Existing drafts get no backfill. The first write after the migration first stores the old state as
  revision 0, "Before history started", then the change. No existing row is rewritten.
- Rebuilding revision `n`: the newest non-null `post_order` at or before `n`, then for each post id the
  newest `body` at or before `n` (index `(draft_id, post_id, seq desc)`).
- PGlite (the test database) must support PL/pgSQL triggers: not checked; the first step of H2 checks
  it. If it does not, the same logic runs in the routes inside a transaction (more code, same tables).

### 2.4 Showing a change: how do we know where it was?
Posts have stable ids, so a diff between two revisions is a short list of facts:
- "Post 3 changed" (same id, different body), with a **word-level diff** inside it;
- "Post 5 added after post 4" and "Post 2 removed";
- "Posts moved: 6 is now 2" (the longest run of posts that kept their order stays; the rest are moves);
- "Title changed"; "Image added to post 1"; "Image removed from post 4".

Words are cut with `Intl.Segmenter` (`granularity: 'word'`), which handles Hebrew and English; emoji and
combining marks stay whole because the cut uses grapheme clusters. Diff: Myers on the word list (a post
has under 100 words, so it is instant). One shared module (`src/utils/revisionDiff.js`, task H4) runs in
the browser and on the server, as `src/utils/xLength.js` already does.

Hard cases:
- **An AI rewrites everything** with `update_draft` and new post ids: every post looks removed and
  added. Rule: a removed and an added post at the same position are shown as "Post 3 rewritten", with
  before and after side by side; the word diff is shown only when at least 30 % of words are shared,
  otherwise it is noise.
- **A moved and edited post** keeps its id: "Post 6 moved to 2 and changed".
- **Many changes at once**: the summary line counts them ("ChatGPT changed 5 posts, added 2").

In the editor (task H9): a History panel lists revisions (who, when, summary). Clicking one shows that
revision; "Compare with current" shows changed posts with removed words struck through and added words
underlined (not colour alone). Each post box has `dir="auto"`, so Hebrew reads right to left and mixed
text keeps its order.

In MCP (task H7) the answer is readable text, never a code block (#358). Example:
> Revision 14 by ChatGPT, 3 minutes ago: changed post 2, added post 5 after post 4.
> Post 2 before: > "..."  
> Post 2 after: > "..."  
> To go back, call restore_revision with revision 13 and version 21.

### 2.5 Restore, conflicts, images, retention, delete
- **Restore never deletes.** `POST /drafts/:id/revisions/:seq/restore` writes the old state as the new
  current state: a new `version`, a new revision "Restored revision 9" (never merged). Later revisions
  stay, so a restore can be undone by restoring again.
- **Conflicts (#354, PR #359):** restore takes `If-Match` with the current `version`. A stale one is
  412 with the current draft, nothing written. MCP `restore_revision` takes `version` the same way.
  A published draft cannot be restored (409, like the post routes and the post tools; note that
  `PATCH /drafts/:id` itself has no published check today). Restoring one post only is a later
  option, not in the first tasks.
- **Images:** today an image file is deleted when no draft uses it any more. With history, a file
  must also stay while a kept revision uses it, or a restore shows a broken image. Rule (task H8): a
  file is deleted only when neither a draft nor a kept revision of that user uses it. Publishing still
  removes images and deletes their files (that is its job today); a later restore of an older revision
  then drops the missing images and says so ("2 images could not be restored").
- **Retention (owner question H1-Q1):** recommended: merge bursts (2 minutes), keep everything for 30
  days, after that keep the last revision of each day, and at most 300 revisions per draft (the oldest go
  first). Compaction removes revision rows and the post rows no kept revision needs. It runs on write,
  every 50th revision of a draft, so no scheduled job is needed.
- **Delete:** deleting a draft deletes its revisions (foreign key cascade) and, first, the image files
  only its revisions used (files-first, like admin delete A9). Admin delete of a user already removes the
  whole `drafts/<user id>/` folder and then cascades; its dry run must count revisions too, and
  `tests/api/admin-schema.test.js` pins that list.

### 2.6 UI, API and MCP aligned
| Capability | API | MCP | UI |
|---|---|---|---|
| List revisions | `GET /drafts/:id/revisions` | `list_revisions` | History panel in `/draft/:id` |
| Read one revision and its diff | `GET /drafts/:id/revisions/:seq` (`?against=<seq>`, default the one before) | `get_revision` | preview and compare |
| Restore | `POST /drafts/:id/revisions/:seq/restore` | `restore_revision` | Restore button with a confirm |
Each row goes into `docs/architecture/capabilities.md` in the PR that adds it.

## 3. Encryption, the honest version

### 3.1 What exists today (checked)
- **Neon** encrypts data on disk with AES-256 and its backups with server-side encryption; keys are in
  AWS KMS or Azure Key Vault; backups are "retained for 30 days". Source:
  https://neon.com/docs/security/security-overview (page dated 2026-11-05, read 2026-11-21). This
  protects against a stolen disk. It does **not** stop anyone who can connect to the database: the app,
  the owner, or Neon staff with access.
- **Vercel Blob**: encryption on disk not checked. Our store is public (above). Vercel Blob also offers
  private files read through our own server (https://vercel.com/docs/vercel-blob/private-storage,
  checked). Its price and free limits: not checked.
- **Vercel KMS**: the docs describe issuers and signing keys for tokens (beta). I found no encrypt or
  decrypt of data. Not checked further; not usable for data keys as far as I could see.

### 3.2 The designs, and what each can promise

**A. Server-held key (application-level encryption).** The server encrypts title and post text with a
key kept in a Vercel environment variable. Protects against: a leaked database dump or connection string,
a leaked Neon backup. **Does not protect against the server, so not against the owner**: whoever can
read the environment variables or change the code can read every draft. Cost: $0, one new secret (an
owner step). AI apps: everything keeps working.

**B. Envelope encryption with a managed key service (KMS) and audit.** Each user has a data key,
wrapped by a key in a KMS outside Vercel; each unwrap is logged by the KMS; no admin code path can ask
for a key. Stronger than A: the database and Vercel alone are not enough, and every read leaves a trace.
**Still not "cannot"**: the owner controls the KMS account and the app code. Cost: a KMS account and
per-request fees: not checked. AI apps: everything keeps working.

**C. Key only the user has (end-to-end, in the browser).** The browser makes a key pair. The private key
is wrapped with the user's passphrase (and a recovery code) and only the wrapped form is stored on our
server. The server stores ciphertext and the user's public key. Only a browser that knows the passphrase
(or the recovery code) can read, and only if the passphrase is strong: the server holds the wrapped key
and its salt, so whoever has the database can guess passphrases offline without limit (section 3.6). **This is the only design that can truthfully support "the owner cannot read it".** Its limits
must be said in the same breath:
- It is a web app: the browser runs code we send. If the owner shipped code that steals the passphrase,
  the promise would break. The code is public (github.com/Shaked/x-thread-draft-tool, a public
  repository, checked), so such a change would be visible, but it cannot be proven that no one does it.
- Text an AI app sends to a draft passes through our server once, in plain form, on its way in. The
  server encrypts it to the user's public key at once and keeps no copy. At that moment a changed server
  could read it.
- **Anyone with database access, the owner included, can replace the stored public key without changing
  any code.** The unchanged public code then seals every later AI write to that key, so it can be read at
  any time. So text added by AI apps is never covered by "cannot read". The browser detects it: on every
  unlock it compares the server's public key with the one inside the wrapped blob and shows "Your key on
  our server was changed" if they differ, and a post that does not open with the user's key is shown as
  "This post was not sealed to your key". The browser never seals its own saves to the server's copy.
- The server can still swap a post's ciphertext for an older one of the same post (it keeps history).
  Locking promises secrecy, not that the server cannot roll a post back.
- Whatever the user shows an AI app is seen by that AI company.

The three ways to let AI apps work with C (the question in #366):
1. **Release the key to the server for an AI session.** The server can then read during the session,
   and so could the owner. This turns C into A for that time: it cannot support "cannot". Not recommended.
2. **Key only in the browser; AI apps lose reading.** AI apps can still create drafts and add or replace
   posts (the server seals the text to the public key: "write-only"), move and remove posts, and restore
   revisions (the server copies ciphertext). They cannot read, shorten, review, export, share as text,
   or show the thread view.
3. **Option B instead.** Everything works, nothing is mathematically blind, every decrypt is audited.

### 3.3 Recommendation
- **Locked drafts (C with way 2), opt-in per draft.** A user turns on "Private drafts" once (passphrase
  plus a recovery code), then can lock any draft. A locked draft gets the strong sentence. A normal draft
  keeps every AI feature.
- **Normal drafts: A**, plus the rules that make its promise true: admin tools show counts only (true
  today), "view as" never shows draft text (section 4), private image files, the leak scan test.
- **Not B for now:** it adds a paid service and an outside account, and it still cannot support "cannot".
  If the owner wants it, it can replace A later without changing the locked drafts.

What the product loses for AI apps on a **locked** draft:
- `get_draft`, `list_drafts` with full detail, `export_draft`: text unavailable ("This draft is locked.
  Open it in the browser to read it.").
- `get_draft_outline` and `list_drafts`: no titles and no previews ("Locked draft, 7 posts"); the X
  length of each post stays visible (kept as a plain number, so the AI app can still say "post 3 is over
  280"). The title is locked too, so an AI app cannot find a locked draft by its name.
- `update_post` replaces a whole post but cannot "shorten post 3" (it cannot read post 3). The prompts
  `tighten_draft`, `review_before_publish`, `rewrite_hook` do not work.
- Share links: the page for a person works (the key travels in the part of the link after `#`, which
  browsers never send to the server). The `.md` link for AI agents does not work: an agent's fetch sends
  no `#` part.
- The thread view inside AI apps cannot show the posts.
- History works (list, restore); the word diff is shown only in the browser.
- Duplicate: a locked draft is duplicated in the browser (new draft and post ids need new seals). REST and
  MCP `duplicate_draft` answer 409 for it.
- To use AI on a locked draft, the user unlocks it (it becomes a normal draft, with the weaker promise).

### 3.4 The sentences to show the user (only these; nothing more)

Normal draft (A plus the rules above):
- EN: "The text of your drafts is stored encrypted. The app's server holds the key, so it can read your
  drafts to show them to you and to the AI apps you connect, and whoever runs the app can read them too.
  Images are stored as private files, not encrypted. Our admin screens show counts, never your text."
- HE: "הטקסט של הטיוטות שלך נשמר מוצפן. המפתח נמצא בשרת של האפליקציה, ולכן השרת יכול לקרוא את הטיוטות
  כדי להציג אותן לך ולאפליקציות ה-AI שחיברת, וגם מי שמפעיל את האפליקציה יכול לקרוא אותן. תמונות נשמרות
  כקבצים פרטיים, לא מוצפנים. מסכי הניהול שלנו מציגים רק מספרים, אף פעם לא את הטקסט שלך."
- The image part may be shown only after H12 (private images) is live; until then the sentence says
  "Images are stored as files that anyone with their link can open." The last part may be shown only after
  H11 (view as hides text) is live.

Locked draft (C):
- EN (short, next to the lock): "Locked: your browser encrypts this draft before it is saved. Only you,
  and people you send a share link to, can open it. We, including the app's owner and admin, cannot read
  what you write in it while the app runs its public code. Text and images an AI app adds pass through our
  server."
- EN (details, one tap away): "Your browser locks this draft with a key that only your passphrase or
  recovery code can open. Our server keeps the locked copy, and your key only in locked form. AI apps you
  connected can add text, but they cannot read this draft; what they add passes through our server and is
  not covered by this promise. If you lose both your passphrase and your recovery code, nobody can open
  it, not even us. Older unlocked copies may stay in our database provider's backups for up to 30 days.
  This holds as long as the app runs the public code on GitHub."
- HE (קצר): "נעול: הדפדפן שלך מצפין את הטיוטה הזאת לפני שהיא נשמרת. רק את/ה, ומי ששלחת לו קישור שיתוף,
  יכולים לפתוח אותה. אנחנו, כולל הבעלים והמנהל של האפליקציה, לא יכולים לקרוא את מה שכתבת בה, כל עוד
  האפליקציה מריצה את הקוד הציבורי שלה. טקסט ותמונות שאפליקציית AI מוסיפה עוברים דרך השרת שלנו."
- HE (פרטים): "הדפדפן שלך נועל את הטיוטה עם מפתח שרק הסיסמה שלך או קוד השחזור יכולים לפתוח. השרת שלנו
  שומר את העותק הנעול, ואת המפתח שלך רק בצורה נעולה. אפליקציות AI שחיברת יכולות להוסיף טקסט, אבל הן לא
  יכולות לקרוא את הטיוטה; מה שהן מוסיפות עובר דרך השרת שלנו ולא מכוסה בהבטחה הזאת. אם תאבד/י גם את
  הסיסמה וגם את קוד השחזור, אף אחד לא יוכל לפתוח אותה, גם לא אנחנו. עותקים ישנים לא נעולים עשויים
  להישאר בגיבויים של ספק מסד הנתונים שלנו עד 30 יום. זה נכון כל עוד האפליקציה מריצה את הקוד הציבורי
  שב-GitHub."
- The "30 days" part may be shown only after the Neon preview-branch question in section 1 is checked. If
  preview branches copy production data, H19 must also clear those copies, or the sentence must name them.

If the owner picks B instead of A, the normal-draft sentence becomes: "Your drafts are encrypted with keys
kept in a separate key service. The app opens a draft only for you or an AI app you connected, and every
opening is logged. Our admin screens cannot open drafts. Whoever runs the app could still change its code
to read them." No sentence with "cannot read" may be shown for a normal draft under A or B.

Banned words in any UI text: "zero knowledge", "military grade", "nobody can ever", "100 %".

### 3.5 What still leaks, even for a locked draft
- **Shape**: number of drafts and posts, post order and ids, X length per post, image count, times of
  each save, which actor saved, published or not. Admin statistics keep counts only, which this allows.
  Ciphertext size also shows length; posts are padded to 64-byte steps so it shows no more than the X
  length already does.
- **Images**: a locked draft's images are encrypted in the browser before upload; the editor shows them
  from a decrypted copy. Images added from a URL: both MCP
  `add_image_from_url` and the editor call `POST /images/from-url`, which today stores the fetched bytes
  as a public file (`server/routes/images.js`, checked). For a locked draft that route must seal the
  fetched bytes to the user's public key before `putBlob` and keep no plain copy; the source URL is sealed
  inside the post. The server saw the image on the way in, like AI text.
- **Share page**: a person's share link decrypts in the recipient's browser; whoever has the full link
  can read it (as today).
- **Exports**: made in the browser for locked drafts.
- **Logs and errors**: the leak scan test (H10) proves no text reaches logs or error answers.
- **Backups**: plain text written **before** a draft was locked stays in Neon's history for up to 6 hours
  and in Neon's backups for up to 30 days. The lock screen says so: "Older copies of this draft may stay
  in our database provider's backups for up to 30 days." Neon preview branches may hold copies too: not
  checked (section 1); the sentence ships only once that is checked.
- **Search**: there is no server search today. A locked draft can only be searched in the browser.

### 3.6 Key management
- **Locked drafts:** WebCrypto only, no new library. ECDH P-256 key pair per user; each post sealed with
  a fresh ephemeral key, HKDF and AES-256-GCM, bound to draft id and post id (so ciphertext cannot be
  moved to another post or draft). It is **not** bound to the revision `seq`: a restore copies an old
  ciphertext into a new revision, and the server cannot re-encrypt it, so a `seq` binding would make every
  restored post fail to open (Codex finding on PR #404). The wrapped blob is the private JWK (`d`, `x`,
  `y`) under AES-GCM. The browser decrypts it, uses `x` and `y` as its public key, imports `d` as a
  non-extractable `CryptoKey` and drops the JWK. (WebCrypto cannot derive a public key from a
  non-extractable private key.) The browser seals its own saves to that public key, never to the copy the
  server sends. Private key wrapped with AES-GCM under a key from PBKDF2-SHA-256 (600,000
  iterations: OWASP's figure, https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html,
  not re-read today; Argon2 is not in WebCrypto). Because whoever has the database can guess offline,
  setup offers a generated passphrase of 6 words from a bundled 7,776-word list (about 77 bits); a typed
  passphrase must be at least 16 characters and not on a bundled list of common passwords. A second wrap
  under a random recovery code shown once: 24 Crockford base32 characters (120 bits), stretched with HKDF. The unwrapped key lives in the browser as a
  non-extractable `CryptoKey` for the tab's life, never in `localStorage`. Passkey unlock (WebAuthn PRF):
  browser support not checked, so not in the first tasks.
- **Locked post format:** `{ id, sealed, xlen, images }`. The text and `embeddedTweet` are inside
  `sealed`. Image URLs, which point to encrypted files, stay plain, so the "still used" image check
  (`usedImageUrls` in `server/routes/drafts.js`) and the admin image counts keep working.
- **Loss:** if the user loses both passphrase and recovery code, the locked drafts are gone. No escrow:
  any copy we kept would break the promise. This is an owner decision (H1-Q3).
- **Rotation:** a new passphrase re-wraps the private key only (fast). A new key pair re-encrypts every
  locked post in the browser (a later task, not first).
- **A (server key):** one secret, `DRAFT_DATA_KEY` (32 random bytes, base64). Each ciphertext starts with
  a key id (`k1:`), so a second key can be added and old rows re-encrypted later. The owner creates it on
  his own computer and pastes it into Vercel; it is never in the repository, in chat or in logs. Separate
  values for Preview and Production. Exact steps are in task H13. If the key is lost, normal drafts are
  lost too, so the owner keeps a copy in his password manager.
- **Free-tier limits** of any KMS: not checked (no KMS is in the recommendation).

### 3.7 Migration of existing drafts
- **A:** new writes are encrypted; reads accept both forms. Then a script encrypts old rows in batches:
  a dry run that counts and changes nothing, then batches of 100 that keep the plain copy in a backup
  column until a check reads every row back. Clearing the backup column is a separate step that the owner
  approves (deleting data). Reversible until then. Tests with fake data only. Admin delete keeps working
  (it never reads text).
- **C:** nothing is migrated by us. A user locks a draft in the browser: the browser downloads the
  current posts and every kept revision, encrypts them and uploads them; the server swaps them in one
  transaction and checks that every `(post id, seq)` it holds was replaced. In the same transaction it
  clears every other copy the server could read: the plain backup columns of the migration above and any
  server-key (`k1:`) values of that draft. If a backup copy cannot be cleared, the lock is refused, so a
  locked draft never keeps a readable copy in our database (Codex finding on PR #404). Only the provider's
  backups (section 3.5) remain. Unlocking is the reverse, in the browser.
- **The history trigger must not undo this.** The lock swap is an `UPDATE drafts`, so the trigger of 2.3
  would fire on it, and on a draft with no history yet it would store the old plain state as revision 0.
  Lock, unlock and the H14 batches therefore run with `set local app.revision_mode = 'rewrite'`, and the
  trigger writes nothing in that mode. H14 also encrypts `draft_revisions.title` and
  `draft_post_versions.body`, which H2 may have written in plain form before H13. The lock check runs last
  in the transaction: no row of the draft in `drafts`, `draft_revisions` or `draft_post_versions` holds an
  unsealed value, or the lock is refused.

## 4. Admin and "view as"
- **Admin MCP tools and admin UI (#283 to #288):** they read counts only today (checked). The rule stays:
  no admin route or tool ever selects a title, post text, embedded tweet URL, image URL or revision body.
  The leak scan test (H10) runs every admin route and tool and fails on the marker text.
- **View as (#289 to #291, not built yet):** as designed, the admin's browser gets the target's
  `GET /drafts` answers, so **the admin would see every draft in full**. That breaks every sentence in
  3.4, even the weak one. Rule (task H11): while viewing as, draft reads answer the list with titles
  replaced by "Private draft" and counts only; `GET /drafts/:id`, export, outline previews, revisions
  and images answer 403 "Viewing as cannot open drafts". For a locked draft this also holds by math: the
  admin's browser has no key. For a normal draft it holds by code only, which the sentence for normal
  drafts already admits ("the server can read them"). This is owner question H1-Q4, because the owner
  asked for view as to show "how another user sees the website".
- **The owner's own access** (Neon console, connection string, Vercel settings, Blob token) is not an
  admin feature and no code rule can close it. Under A it reads everything; under C it reads ciphertext.

## 5. Tests that run free (no network, no model, no person)
- **Diff and restore (H4, H5, H6):** a seeded random generator (no new library) makes pairs of drafts
  (edits, adds, removes, moves, Hebrew, emoji with skin tones and ZWJ, combining marks, RTL marks, a
  1 MB draft). Properties: applying `diff(a, b)` to `a` gives `b`; `diff(a, a)` is empty; restore of
  revision n then diff against n is empty; rebuilding every revision of a 300-step history matches the
  states that were written; the word diff never splits a grapheme.
- **Trigger (H2, H3):** each write route makes exactly one revision or merges into the last one; two
  actors never merge; the query count per route is unchanged.
- **Encryption (H13, H15, H16):** ciphertext never contains the plaintext or a 4-character piece of it
  (Hebrew too); a wrong key or passphrase fails; a post's ciphertext moved to another post or draft fails; a restored
  ciphertext still opens; locking clears the migration backup copy of that draft;
  key rotation (A) reads old and new rows; a wrong-format write to a locked draft is refused.
- **Plaintext leak scan (H10, first and independent):** a test creates drafts with a unique marker
  through REST and MCP, edits and shares them, makes errors happen, then checks that the marker is absent
  from: every captured `console` line, every error answer, every admin route and admin tool answer, every
  table except the ones that are allowed to hold text (today `drafts`; later only ciphertext), and, for a
  locked draft, every table and every answer to a non-owner.
- **Admin and view as (H11):** every route under view as answers without the marker.

## 6. Tasks (all labelled `task` and `held`; none started)
Each issue holds its full plan. H2 to H19 are sub-issues of #273; H20 (#402) is a sub-issue of #366, because GitHub refused a 101st sub-issue on #273
("Parent cannot have more than 100 sub-issues", checked). Rules for all: the Rules section of #275.
Revisions do not wait for the encryption decision; each task waits for the owner questions it names.

| Task | Issue | What | Executor | Validator | Size | Depends on |
|---|---|---|---|---|---|---|
| H2 | #375 | Revision tables and the trigger | Sonnet 5.5 (PL/pgSQL) | Opus | M | H1-Q1 answered |
| H3 | #376 | Every writer names itself (actor on each write) | Haiku 5.5 | Opus | S | H2 |
| H4 | #377 | Diff core, shared by browser and server | Haiku 5.5 | Sonnet | M | none (H1-Q1 answered) |
| H5 | #378 | REST: list and read revisions, with the diff | Haiku 5.5 | Opus | M | H2, H3, H4 |
| H6 | #379 | REST: restore a revision | Haiku 5.5 | Opus | M | H5 |
| H7 | #380 | MCP: `list_revisions`, `get_revision`, `restore_revision` | Haiku 5.5 | Sonnet | M | H5, H6, text rules of #358 |
| H8 | #382 | Retention, compaction, images kept by history, delete paths | Haiku 5.5 | Opus | M | H2, H1-Q1 |
| H9 | #383 | History panel in the editor | Haiku 5.5 | Sonnet, Opus judges the design | M | H5, H6, #327, #328, #361 |
| H10 | #384 | Plaintext leak scan test | Haiku 5.5 | Opus | S | none (H1-Q2 answered) |
| H11 | #385 | "View as" never shows draft text | Haiku 5.5 | Opus | S | #289, #290, H1-Q4 |
| H12 | #387 | Private image files, read only through the app | Sonnet 5.5 | Opus | M | H1-Q2 (a, b or c), owner step |
| H13 | #389 | Server-key encryption of draft text (design A) | Opus 5.5 | Opus (second agent) | M | H1-Q2 (a or c), owner secret, H10 |
| H14 | #391 | Encrypt existing drafts: dry run, batches, reversible | Sonnet 5.5 | Opus | M | H13 |
| H15 | #393 | Private drafts: key setup in the browser | Opus 5.5 | Opus (second agent) | M | H1-Q2 (a or b), H1-Q3 |
| H16 | #394 | Locked draft format on the server and sealed writes for AI apps | Opus 5.5 | Opus (second agent) | L | H15, H2, H3 |
| H17 | #397 | MCP and share links for locked drafts | Sonnet 5.5 | Opus | M | H16 |
| H18 | #398 | Editor opens, saves and compares locked drafts | Sonnet 5.5 | Opus | L | H16, H9 |
| H19 | #400 | Lock or unlock an existing draft (history too) | Opus 5.5 | Opus (second agent) | M | H16, H18 |
| H20 | #402 | Privacy sentences in the app (EN and HE) | Haiku 5.5 | Opus | S | H1-Q2 and the tasks it needs |

Fallback for every task: if Haiku fails the same step twice, Sonnet does that step (AGENTS.md).
PR body line of each: `Implements #273 Task H<n>`.

## 7. Owner questions (posted on #273)
- **H1-Q1, revisions: how much history to keep?** (a) 30 days of every revision, then one per day, at most
  300 per draft (recommended); (b) keep everything forever; (c) only the last 50 revisions.
- **H1-Q2, the privacy promise: which design?** (a) opt-in locked drafts plus server-key encryption for the
  rest (recommended); (b) every draft locked; (c) server key only, no "cannot read" promise; (d) nothing
  beyond the provider's disk encryption.
- **H1-Q3, a lost passphrase on a locked draft:** (a) a recovery code shown once, no copy kept by us
  (recommended); (b) no recovery at all; (c) we keep a recovery copy (then "cannot read" is false).
- **H1-Q4, "view as" and draft text:** (a) view as shows counts and "Private draft", never text
  (recommended); (b) view as shows everything (then no sentence about admins is true).
If nobody answers, nothing in section 6 is built. Answers are recorded in #273 with the date.

## Decisions taken by Opus in this plan (Shaked can change them)
- Per-post snapshots (b), written by a database trigger; merge window 2 minutes; never merge two actors.
- Restore writes a new revision and needs `If-Match` like every write (412, PR #359).
- A personal API token shows as "API token" in history, never its name.
- Locked drafts keep the X length per post as a plain number (shape already leaks; it keeps limit checks).
- No KMS in the first plan.
- Security review by a second Opus agent (2026-11-25): 13 findings, all applied. The main ones: the locked-draft
  sentence no longer covers text an AI app adds (the stored public key can be replaced through the database),
  passphrases must be strong (offline guessing), images added from a URL are sealed, and the history trigger
  is off while a draft is locked or migrated.
