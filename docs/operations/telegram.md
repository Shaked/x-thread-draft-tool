# Telegram messages

Short notices in a Telegram chat with the owner. They are sent only by GitHub Actions. The app itself sends nothing. Epic #241 (tasks N1, N2, N4).

Code:
- `scripts/notify-telegram.mjs`: builds the text and sends it.
- `scripts/notify-label.mjs`: decides when a label sends a message.
- `.github/workflows/smoke-deployed.yml`: the two production kinds, after the deployed smoke test.
- `.github/workflows/notify-labels.yml`: the two label kinds.

## The four kinds

| Kind | Headline | When it is sent | Links |
|---|---|---|---|
| Production is live and tested | ✅ Production is live and tested | A production deployment is live and the deployed smoke test passed. Step "Telegram: production is live and tested". | Open production |
| Production smoke FAILED | 🚨 Production smoke FAILED | The smoke test on a production deployment failed or was skipped. Not sent when the run was cancelled, for example when a newer deployment replaced it. Step "Telegram: production smoke failed". | See the failed run |
| Try it on preview | 👀 Try it on preview | A pull request gets the label `try-preview`, added by the repository owner's account. The same label on an issue sends nothing. | Open preview, and PR #n |
| Needs you | 🙋 Needs you | The label `owner` is added to an issue or a pull request, by the repository owner's account. | Open (the issue or PR) |

What a message looks like:
- Line 1: the emoji and the headline, in bold (in the HTML version; the plain-text fallback has no bold).
- Line 2: for the two production kinds, the short commit id (7 characters, in code font) and the commit title. For the other two kinds, the issue or PR title.
- Line 3 (production kinds only): "Smoke tests passed." or "The smoke test did not pass."
- Last line: the links, separated by " · ".

Titles are cut to 120 characters.

Nothing else sends a message. There is no message for a push, a new PR, a CI run, a merge, a preview build, or a docs-only merge. A failed Vercel deployment sends nothing either: the smoke job runs only when the deployment state is `success`. A docs-only merge creates no deployment (`scripts/vercel-ignore.mjs` skips the build).

Limits of the text today:
- The "passed" line has no number. "N/N passed" is not in the code yet.
- The try-preview message does not say what to try. It has only the links.

## The two secrets, and how to set them

The owner sets these once. Agents cannot create a bot or write a repository secret.

1. In Telegram, open a chat with `@BotFather`, send `/newbot`, choose a name and a username ending in `bot`. BotFather answers with a token that looks like `123456:ABC...`. Do not paste it in any chat or issue.
2. Open your new bot in Telegram and press Start. A bot cannot message you before you do this.
3. Get your chat id: open `https://api.telegram.org/bot<TOKEN>/getUpdates` in your browser after you sent the bot one message (replace `<TOKEN>` with your token). The number at `"chat":{"id":...}` is your chat id. Or message `@userinfobot`, which replies with your id.
4. In GitHub, open https://github.com/Shaked/x-thread-draft-tool/settings/secrets/actions and press "New repository secret" twice:
   - name `TELEGRAM_BOT_TOKEN`, value: the token;
   - name `TELEGRAM_CHAT_ID`, value: the number.

The names must match exactly.

## How to turn it off

Delete either secret, `TELEGRAM_BOT_TOKEN` or `TELEGRAM_CHAT_ID`. Nothing else changes. Each notify step then prints `notify skipped: no Telegram secrets`, and the workflow stays green. Add the secret again to turn it back on.

## What a message never contains

- No token, no chat id, no other secret.
- No login names, no draft text, no post text, no PR body, no diff, no log output.
- Only: the short commit id, a commit or issue/PR title (cut to 120 characters), fixed text, and links. The production links go to the production address or to the failed run; the preview link goes to the preview address; the try-preview and needs-you messages also link to the PR or issue.

The text is sent as HTML with escaping. Only if Telegram answers HTTP 400 with a parse error does the script send the same text once more as plain text (log line `notify: HTML rejected, sending plain text`). Any other refusal is not retried.

## How to test

- Try-preview: add the label `try-preview` to a pull request. The pull request must contain `.github/workflows/notify-labels.yml`, which means it was opened after #249 was merged. A pull request event starts the workflow only if the workflow file exists in the pull request's code (not checked: whether GitHub uses the pull request's own commit or its test merge). Use a pull request opened after #249.
- Needs you: add the label `owner` to an issue or a pull request.
- Production: merge a change that creates a production deployment. The message comes from the smoke test that runs after that deployment. A docs-only merge sends nothing.

Use only a pull request that is still open and that you want to test with.

## If no message arrives

Open the Actions run. The step log is the proof. A green check does not prove a message was sent, because the steps never fail the job.

- Production kinds: workflow "Smoke test (deployed)", job "Smoke test", step "Telegram: production is live and tested" or "Telegram: production smoke failed".
- Label kinds: workflow "Notify labels (Telegram)", job "Telegram label notice", step "Send the label notice".

Read the last line of the step:

- `notify skipped: no Telegram secrets`: one of the two secrets is missing, or its name is wrong. Check both names in the secrets page.
- `notify skipped: this label event sends nothing`: `try-preview` was added to an issue, or the account that added the label is not the repository owner. (Other labels do not start this job at all.)
- `notify failed: HTTP 400`: Telegram refused the chat. The usual cause is that the bot was not started in the chat (press Start in the bot), or the chat id is wrong. This was the cause at the first setup on 2026-11-19.
- `notify failed: <error name>`: the request did not reach Telegram. Run again later. Not checked further.
- `notify sent`: Telegram accepted the message. If it is still not in the chat, check the chat and the bot. Not checked further.

The label check: it is not known yet whether a label that an agent adds comes from the owner's account. The first `try-preview` message will show it. If the log says "sends nothing" for an agent's label, that is the reason.

## Ideas for later (not in the code)

- Quote blocks (`<blockquote>`) in the message. Not used. Telegram's API docs were not checked when this was written.
- Link preview options. The code asks for link previews (`disable_web_page_preview` is false). The newer `link_preview_options` setting is not used. Not checked.
- A passed count ("N/N passed") in the production message.
- A line in the try-preview message that says what to try.
