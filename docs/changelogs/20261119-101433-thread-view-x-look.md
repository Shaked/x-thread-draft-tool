# MCP thread view looks like X (T3, #173)

- The MCP thread view draws each post as an X-style card: avatar, post number, counter (`chars/280`, red with "over by n"), links as buttons, images from our Blob store only, an embedded-tweet card, light and dark themes, and Hebrew or English direction per post. Still not linked to any tool (T4 does that).
- The X card CSS moved from `server/share/render.js` to `server/share/x-css.js` with CSS variables; the share page looks the same.
