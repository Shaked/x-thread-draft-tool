# Image links can redirect

- Adding an image from a link now follows up to 3 redirects, so shortened and file-host links work.
- Each redirect is checked again: only public web addresses are allowed, and all of them share one 10 second limit.

Area: Security
Link: https://github.com/Shaked/x-thread-draft-tool/pull/595

## Technical details

`fetchRemoteImage` in `server/remote-image.js` re-parses the URL, re-resolves DNS and uses `pinnedFetch` on every hop. Implements #417.
