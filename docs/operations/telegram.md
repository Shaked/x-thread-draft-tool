# Telegram messages

Short notices in a Telegram chat with the owner. They are sent only by GitHub Actions. The app itself sends nothing. Epic #241 (tasks N1, N2, N4) and epic #255 (task C3, the cleanup kind).

Code:
- `scripts/notify-telegram.mjs`: builds the text and sends it.
- `scripts/notify-label.mjs`: decides when a label sends a message.
- `scripts/cleanup-review-check.mjs`: sends the "Cleanup review started" message when the daily workflow opens an issue.
- `.github/workflows/smoke-deployed.yml`: the two production kinds, after the deployed smoke test.
- `.github/workflows/notify-labels.yml`: the three label kinds.
- `.github/workflows/cleanup-review-daily.yml`: starts the cleanup message (see `docs/operations/cleanup-review.md`).
- `.github/workflows/speed-metrics.yml`: the speed kind, from a manual run of the speed metrics (epic #273, task #310). The per-merge check sends nothing.

## The six kinds

This section describes what the script sends today. The target format, with no emoji and one action line, is `.claude/skills/reply-style/templates/telegram-message.md`; task #369 moves the script to it. "The target messages" below shows each one.


| Kind | Headline | When it is sent | Links |
|---|---|---|---|
| Production is live and tested | ✅ Production is live and tested | A production deployment is live and the deployed smoke test passed. Step "Telegram: production is live and tested". | Open production |
| Production smoke FAILED | 🚨 Production smoke FAILED | The smoke test on a production deployment failed or was skipped. Not sent when the run was cancelled, for example when a newer deployment replaced it. Step "Telegram: production smoke failed". | See the failed run |
| Try it on preview | 👀 Try it on preview | A pull request gets the label `try-preview`, added by the repository owner's account. The same label on an issue sends nothing. | Open preview, and PR #n |
| Needs you | 🙋 Needs you | The label `owner` is added to an issue or a pull request, by the repository owner's account. | Open (the issue or PR) |
| Cleanup review | 🧹 Cleanup review | A pull request gets the label `cleanup-pr`, added by the repository owner's account. The same label on an issue sends nothing. Also "🧹 Cleanup review started" when the daily workflow opens a cleanup issue (same kind, different headline). | Open PR #n (or Open issue #n for the started message) |
| Speed budget over limit | Speed over the budget: <stages> (no emoji; the headline is the link) | A manual run of `speed-metrics.yml` (input `last`) finds a stage whose p90 is over its limit (`docs/plans/speed.md` section 1). Four lines of numbers: the window (the last N merged PRs and the date of the oldest), then one line per stage over its limit with its p90, limit and usual (median) value, then "Nothing needed: this check only warns." The link opens the run, whose summary has the stage table. The per-merge check after a production smoke run sends nothing. | The headline (the run) |

What a message looks like:
- Line 1: the emoji and the headline, in bold (in the HTML version; the plain-text fallback has no bold).
- Line 2: for the two production kinds, the short commit id (7 characters, in code font) and the commit title. For the other kinds, the issue or PR title. The cleanup kinds show the title in a quote block.
- Line 3 (production kinds only): "Smoke tests passed." or "The smoke test did not pass."
- Cleanup kind only, line 4 (after the link): the first line of the PR body, when it starts with `Summary:` (the text after `Summary:`, cut to 120 characters). No such line means no summary line.
- Links line, separated by " · " (for the cleanup kind it is line 3, and the summary, when there is one, comes after it).

Titles are cut to 120 characters.

Nothing else sends a message. There is no message for a push, a new PR, a CI run, a merge, a preview build, or a docs-only merge. A failed Vercel deployment sends nothing either: the smoke job runs only when the deployment state is `success`. A docs-only merge creates no deployment (`scripts/vercel-ignore.mjs` skips the build).

Limits of the text today:
- The "passed" line has no number. "N/N passed" is not in the code yet.
- The try-preview message does not say what to try. It has only the links.

## The target messages

Not sent yet. The script moves to these texts in the Telegram code step of task #369, with a golden test for each.
The rules and the placeholders are in `.claude/skills/reply-style/templates/telegram-message.md`. Bold is the headline, and
the headline is the link. English only: the owner reads English.

| Kind | Example |
|---|---|
| Production passed | **Production is live and tested**<br>`46070af` Thread view: one action row and purple accent<br>Nothing needed.<br>See the run |
| Production failed | **Production smoke test failed**<br>`46070af` Thread view: one action row and purple accent<br>Production runs this commit, and its smoke test failed or did not run.<br>Needs you: open the run and read the first failed step.<br>Open production |
| Try it on preview | **Try it on preview**<br>Thread view: one action row and purple accent<br>What changed: the thread view shows its three buttons in one row.<br>Needs you: try the change on preview.<br>PR #424 on GitHub |
| Needs you | **An issue needs you**, or **A PR needs you**<br>Changelog entries and Telegram messages follow the writing templates<br>Needs you: open it and answer or do what it asks. |
| Cleanup review ready | **Cleanup review ready**<br>Remove duplicate tests<br>What it removes: two parser tests that check the same thing.<br>Needs you: review the PR, then merge or close it. Agents never merge a cleanup PR. |
| Cleanup review started | **Cleanup review started**<br>Cleanup review 2026-11-25<br>Nothing needed. An agent reviews the commits since the last review and opens up to three PRs. |
| Metrics alert | **Metrics alert: slow answers**<br>Slow: the slowest 5 % of API requests took 1380 ms or more in the last 24 hours. The limit is 1000 ms.<br>Needs you: open the metrics page and find the route with the errors or the slow answers. |

What the code step changes, besides the text:
- The needs-you headline says "A PR needs you" or "An issue needs you". `scripts/notify-label.mjs` knows which, and passes it on.
- The "What changed" line of the try-preview message reads the `Summary:` line of the PR body, as the cleanup message does today.
- The production passed message links the run only when `smoke-deployed.yml` passes `NOTIFY_RUN_URL` for it. Today it passes it only for the failed message.
- No workflow sends a metrics alert yet. Task O7 of `docs/plans/observability.md` adds the kind `metrics` and uses this text.

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
- Only: the short commit id, a commit or issue/PR title (cut to 120 characters), fixed text, and links. The production links go to the production address or to the failed run; the preview link goes to the preview address; the try-preview, needs-you and cleanup messages also link to the PR or issue.
- From a PR body, only the first line, and only when it starts with `Summary:` (cut to 120 characters). The rest of the PR body is never sent.

The text is sent as HTML with escaping. Only if Telegram answers HTTP 400 with a parse error does the script send the same text once more as plain text (log line `notify: HTML rejected, sending plain text`). Any other refusal is not retried.

## How to test

- Try-preview: add the label `try-preview` to a pull request. The pull request's code must contain `.github/workflows/notify-labels.yml`. A pull request event starts the workflow only if that file is there (not checked: whether GitHub uses the pull request's own commit or its test merge). Use a pull request opened after #249.
- Needs you: add the label `owner` to an issue or a pull request.
- Cleanup review: add the label `cleanup-pr` to a pull request. The label workflow must be in the default branch (it runs the script from there). A PR whose first body line starts with `Summary:` shows that line.
- Production: merge a change that creates a production deployment. The message comes from the smoke test that runs after that deployment. A docs-only merge sends nothing.

Use only a pull request that is still open and that you want to test with.

## If no message arrives

Open the Actions run. The step log is the proof. A green check does not prove a message was sent, because the steps never fail the job.

- Production kinds: workflow "Smoke test (deployed)", job "Smoke test", step "Telegram: production is live and tested" or "Telegram: production smoke failed".
- Label kinds: workflow "Notify labels (Telegram)", job "Telegram label notice", step "Send the label notice".
- Speed kind: workflow "Speed metrics", job "Speed metrics", step "Measure the last merged pull requests" (the manual run only).

Read the last line of the step:

- `notify skipped: no Telegram secrets`: one of the two secrets is missing, or its name is wrong. Check both names in the secrets page.
- `notify skipped: this label event sends nothing`: `try-preview` was added to an issue, or the account that added the label is not the repository owner. (Other labels do not start this job at all.)
- `notify failed: HTTP 400`: Telegram refused the chat. The usual cause is that the bot was not started in the chat (press Start in the bot), or the chat id is wrong. This was the cause at the first setup on 2026-11-19.
- `notify failed: <error name>`: the request did not reach Telegram. Run again later. Not checked further.
- `notify sent`: Telegram accepted the message. If it is still not in the chat, check the chat and the bot. Not checked further.

The label check: it is not known yet whether a label that an agent adds comes from the owner's account. The first `try-preview` message will show it. If the log says "sends nothing" for an agent's label, that is the reason.

## Ideas for later (not in the code)

- Quote blocks (`<blockquote>`) are used by the cleanup messages only. Telegram's support for them was not checked against the live API. If Telegram refuses the HTML, the plain-text fallback sends the same text.
- Link preview options. The code asks for link previews (`disable_web_page_preview` is false). The newer `link_preview_options` setting is not used. Not checked.
- A passed count ("N/N passed") in the production message.
- A line in the try-preview message that says what to try.
