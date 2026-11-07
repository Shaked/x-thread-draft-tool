# Service worker takes over on update

- New service worker versions activate immediately (`skipWaiting` + `clientsClaim`). Before, a
  waiting worker only took over after every tab was closed, so open or installed copies kept
  showing an old build (for example, the preview kept showing a build without the token page).
