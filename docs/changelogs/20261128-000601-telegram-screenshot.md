# Production notice can carry the screenshot

- When a merge to production comes with a changelog screenshot, the Telegram notice shows it as a photo.
- Without a screenshot the notice stays a text message, and a photo problem never loses the notice.
Area: Docs
Link: https://github.com/Shaked/x-thread-draft-tool/pull/0
Screenshot: not needed, CI only

## Technical details

`scripts/notify-telegram.mjs` sends `sendPhoto` for the live kind when the deployed commit added a changelog entry with `Screenshot: img/<name>.png`. It checks the path, file type and size, cuts the caption to 1024 characters and falls back to `sendMessage`. `smoke-deployed.yml` only checks out the full history. Implements #273 Task N5. Closes #628.
