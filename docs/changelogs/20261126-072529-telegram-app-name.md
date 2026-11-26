# Telegram messages name their app

- Every Telegram message now starts with its emoji, the app name in bold and the headline, so a channel shared with another app stays clear.

Area: Admin
Link: https://github.com/Shaked/x-thread-draft-tool/pull/0

## Technical details

App name and addresses come from one DEFAULT_APP constant in scripts/notify-telegram.mjs, with TELEGRAM_APP_NAME and three URL variables as overrides. reply-lint --kind=telegram fails a message without the bold app name (--app= requires an exact name). Golden tests cover every kind for Thread Draft and a second fixture app.
