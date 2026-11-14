# Sharing and Export

- Drafts are private: only the owner can open or export a draft by id. Other people see a draft only through a share link.
- Share links (`/x-thread-preview/<token>`, rendered by `/api/share/<token>?format=html`, or `/api/share/<token>.md`). The **Share** button makes a reusable link that stops after 15 minutes, 1 hour (default), 1 day or 7 days, and copies the preview link.
- The **X Thread** and **Agent link** buttons make one-time links that stop after 1 hour, whichever is first: one read, or the expiry.
- The owner can stop a link at once (API: `DELETE /api/drafts/:id/share-tokens/:token`, or all links of a draft; MCP: `revoke_share_link`).
- Clipboard copy with/without numbering.
- JSON and Markdown exports.
