# Draft Management

- Create, edit, list, and delete drafts.
- Published/archive state for completed drafts.
- Owner vs shared-view behavior separation.

## The app bar

Every signed-in page (the draft list, the editor and API tokens) shows the same bar. It holds the page's actions and a small sign-out button.

Sign out ends this browser's session on the server (the old cookie value stops working), removes drafts cached in this browser (IndexedDB `draft-*`) and shows the login page. It does not disconnect AI apps or API tokens; the settings page does that. The OAuth approval page has "Not you? Sign out" for the same purpose.

- **Phones (768 px and narrower):** a fixed bar at the bottom of the screen, 44 px high plus the phone's safe area, one row. Menus (Share, Export) open as a sheet above it.
- **Wide screens (769 px and wider):** no fixed bar. The same actions sit in the page header.
- **Hide:** the chevron at the end of the phone bar hides the actions. A small tab stays in the same corner to bring them back. The choice is kept in this browser only (`localStorage` key `xt-bar`) and holds on every signed-in page after a reload.
- The login page and shared previews (`/x-thread-preview/<token>`) have no bar.
