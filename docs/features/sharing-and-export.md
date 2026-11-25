# Sharing and Export

- Drafts are private: only the owner can open or export a draft by id. Other people see a draft only through a share link.
- Share links are stored on the server, each with an expiry time (`/x-thread-preview/<token>`, rendered by `/api/share/<token>?format=html`, or `/api/share/<token>.md`). The **Share** button makes a reusable link that stops after 15 minutes, 1 hour (default), 1 day or 7 days, and copies the preview link. The API accepts any lifetime from 60 seconds to 7 days.
- The **X Thread** and **Agent link** buttons make one-time links that stop after 1 hour, whichever is first: one read, or the expiry.
- In an app that shows MCP views, `create_share_link` shows a share card with the links, Copy and the time left. Showing the card does not use up a one-time link.
- In the thread view, "Create share link" sits in the same action row as "Open in editor" and "Full screen" (#357). The buttons use the purple accent from `src/styles/tokens.css`, copied into `server/mcp/ui/tokens.js`.
- The owner can stop a link at once (API: `DELETE /api/drafts/:id/share-tokens/:token`, or all links of a draft; MCP: `revoke_share_link`).
- **Export** is a button next to Share, on phones and on desktop. Its menu has four actions: Copy thread, Copy with numbers (clipboard), Download Markdown and Download JSON. The menu opens above the bottom bar on phones.
