# MCP thread view: readable in apps that drop the view data (#352, G1)

- The thread tools add the thread as markdown after the JSON (posts, editor link, a block of the post text to copy).
- The thread view shows the posts from that markdown when an app sends text parts only or drops `_meta`, and reports its size even without a `ui/initialize` answer. Meant for Grok's empty grey box; Grok itself is not checked.
