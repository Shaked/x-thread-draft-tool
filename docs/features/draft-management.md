# Draft Management

- Create, edit, list, and delete drafts.
- Published/archive state for completed drafts.
- Owner vs shared-view behavior separation.
- Live updates in the open editor (#363): while the page is visible and nothing is unsaved or saving, it checks the draft every 4 s with `If-None-Match` (304 when unchanged), with 15 s checks after 2 min idle and a pause after 10 min (Resume or any input restarts). A newer version replaces the editor's copy, highlights the changed posts and shows "Updated just now".

## The app bar

Every signed-in page (the draft list, the editor and API tokens) shows the same bar. It holds the page's actions and a small sign-out button.

Sign out ends this browser's session on the server (the old cookie value stops working), removes drafts cached in this browser (IndexedDB `draft-*`) and shows the login page. It does not disconnect AI apps or API tokens; the settings page does that. The OAuth approval page has "Not you? Sign out" for the same purpose.

- **Phones (768 px and narrower):** a fixed bar at the bottom of the screen, 44 px high plus the phone's safe area, one row. Menus (Share, Export) open as a sheet above it.
- **Wide screens (769 px and wider):** no fixed bar. The same actions sit in the page header.
- **Hide:** the chevron at the end of the phone bar hides the actions. A small tab stays in the same corner to bring them back. The choice is kept in this browser only (`localStorage` key `xt-bar`) and holds on every signed-in page after a reload.
- The login page and shared previews (`/x-thread-preview/<token>`) have no bar.

## The menu

Every signed-in page has a menu button at the start of its header. It opens a left drawer (closed on load) with Drafts, Theme (Light, Dark, Match device), API tokens, Connected apps, and Sign out. Escape, a press on the dark area, a drawer link and a route change close it. While it is open the page behind cannot be focused and does not scroll; focus returns to the menu button on close. The phone bottom bar keeps its own Sign out.
- Post edits over REST and MCP (#412): `POST /api/drafts/:id/posts` adds a post, `POST /api/drafts/:id/posts/:postId/move` moves it, `DELETE /api/drafts/:id/posts/:postId` removes it. Each honours `If-Match` (412 on a stale version) and refuses a published draft (409). The editor still saves the whole draft.

- Draft history (#375, no UI yet): every write that changes posts or title stores a revision in the database (`docs/architecture/draft-revisions.md`). Nothing is deleted automatically.
