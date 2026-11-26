# Telegram messages

Short notices in a Telegram chat with the owner. They are sent only by GitHub Actions. The app itself sends nothing. Epic #241 (tasks N1, N2, N4) and epic #255 (task C3, the cleanup kind).

Code:
- `scripts/notify-telegram.mjs`: builds the text and sends it.
- `scripts/notify-label.mjs`: decides when a label sends a message.
- `scripts/cleanup-review-check.mjs`: sends the "Cleanup review started" message when the daily workflow opens an issue.
- `.github/workflows/smoke-deployed.yml`: the two production kinds, after the deployed smoke test.
- `.github/workflows/notify-labels.yml`: the three label kinds.
- `.github/workflows/cleanup-review-daily.yml`: starts the cleanup message (see `docs/operations/cleanup-review.md`).
- `.github/workflows/speed-metrics.yml`: the speed kind, from a manual run of the speed metrics (epic #273, task #310) and from the per-merge run after a production smoke test (task M7 of plan #439).

## The six kinds

The script sends the forms in `.claude/skills/reply-style/templates/telegram-message.md` (task #369, step 7). No emoji. Each form has a golden test in `tests/unit/notify-telegram.test.js`. "The messages" below shows each one.


| Kind | Headline (it is the link) | When it is sent | Other links |
|---|---|---|---|
| Production is live and tested | Production is live and tested (the production address) | A production deployment is live and the deployed smoke test passed. Step "Telegram: production is live and tested". | See the run, only when the workflow passes the run link |
| Production smoke test failed | Production smoke test failed (the run) | The smoke test on a production deployment failed or was skipped. Not sent when the run was cancelled, for example when a newer deployment replaced it. Step "Telegram: production smoke failed". | Open production |
| Try it on preview | Try it on preview (the preview address) | A pull request gets the label `try-preview`, added by the repository owner's account. The same label on an issue sends nothing. | PR #n on GitHub |
| Needs you | An issue needs you, or A PR needs you (the item) | The label `owner` is added to an issue or a pull request, by the repository owner's account. | none |
| Cleanup review ready | Cleanup review ready (the PR) | A pull request gets the label `cleanup-pr`, added by the repository owner's account. The same label on an issue sends nothing. | none |
| Cleanup review started | Cleanup review started (the issue) | The daily workflow opens a cleanup review issue. | none |
| Delivery is slower than its limit: <stages> (plain stage names) | The per-merge run after a production merge, when a stage is over its limit: the first merge of a streak over a limit. Again only after the stages have been within their limits for 24 hours. A manual run of `speed-metrics.yml` (input `last`) sends it when a stage's p90 is over its limit. | Alert shape (the template, section 6): "This merge took 3 min 38 s in CI checks. The limit is ..., since <UTC time> (N in a row)." Then the likely cause, or "not known yet", then "Nothing needed." (the per-merge run; a diagnosis follows on the gate issue) or "Nothing needed. The speed check only warns." (manual). Links: the speed table and the stage definitions. | The gate issue (the per-merge run) or the run (manual) |

What a message looks like (the forms in the template):
- Line 1: the headline in bold. It is the link (in the HTML version; the plain-text fallback shows the link as `label: url`).
- Line 2: for the production kinds, the short commit id (7 characters, in code font) and the commit title. For the other kinds, the issue or PR title.
- A fact line, when the kind has one: "What changed" (try-preview) or "What it removes" (cleanup ready), from the PR body. See the note below.
- "Needs you: ..." with one action, or "Nothing needed." on the last text line.
- The other links on one line, separated by " · ". The line is left out when there is no other link.

Titles are cut to 120 characters.

Nothing else sends a message. There is no message for a push, a new PR, a CI run, a merge, a preview build, or a docs-only merge. A failed Vercel deployment sends nothing either: the smoke job runs only when the deployment state is `success`. A docs-only merge creates no deployment (`scripts/vercel-ignore.mjs` skips the build).

## The messages

Sent by the script since task #369, step 7. The rules and the placeholders are in `.claude/skills/reply-style/templates/telegram-message.md`.
Bold is the headline, and the headline is the link. English only: the owner reads English.

| Kind | Example |
|---|---|
| Production passed | **Production is live and tested**<br>`46070af` Thread view: one action row and purple accent<br>Nothing needed.<br>See the run |
| Production failed | **Production smoke test failed**<br>`46070af` Thread view: one action row and purple accent<br>Production runs this commit, and its smoke test failed or did not run.<br>Needs you: open the run and read the first failed step.<br>Open production |
| Try it on preview | **Try it on preview**<br>Thread view: one action row and purple accent<br>What changed: the thread view shows its three buttons in one row.<br>Needs you: try the change on preview.<br>PR #424 on GitHub |
| Needs you | **An issue needs you**, or **A PR needs you**<br>Changelog entries and Telegram messages follow the writing templates<br>Needs you: open it and answer or do what it asks. |
| Cleanup review ready | **Cleanup review ready**<br>Remove duplicate tests<br>What it removes: two parser tests that check the same thing.<br>Needs you: review the PR, then merge or close it. Agents never merge a cleanup PR. |
| Cleanup review started | **Cleanup review started**<br>Cleanup review 2026-11-25<br>Nothing needed. An agent reviews the commits since the last review and opens up to three PRs. |
| Metrics alert | **Metrics alert: slow answers**<br>Slow: the slowest 5 % of API requests took 1380 ms or more in the last 24 hours. The limit is 1000 ms.<br>Needs you: open the metrics page and find the route with the errors or the slow answers. |

Notes:
- The needs-you headline says "A PR needs you" or "An issue needs you". The script decides from the link: a pull request address says PR.
- The "What it removes" line (cleanup ready) comes from the `Summary:` line of the PR body. `scripts/notify-label.mjs` passes the body for the `cleanup-pr` label only, so it shows there.
- The "What changed" line (try-preview) never shows: the preview label does not pass the body, and `messageFromEnv` does not read it. This was already true before task #369.
- The production passed message links the run only when `smoke-deployed.yml` passes `NOTIFY_RUN_URL`. Today it passes it only for the failed message.
- The speed kind uses the Alert shape (template section 6). The per-merge run also opens or updates one gate issue, labelled `task`, titled "Speed gate: delivery is over its limit"; its body holds the state the next run reads back.
- No workflow sends a metrics alert yet. Task O7 of `docs/plans/observability.md` adds the kind `metrics` and uses its form in the template.

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
- Speed kind, manual: workflow "Speed metrics", job "Speed metrics", step "Measure the last merged pull requests".
- Speed kind, per merge: the same workflow, step "Measure the merge" (it needs the two Telegram secrets, and `issues: write` for the gate issue).

Read the last line of the step:

- `notify skipped: no Telegram secrets`: one of the two secrets is missing, or its name is wrong. Check both names in the secrets page.
- `notify skipped: this label event sends nothing`: `try-preview` was added to an issue, or the account that added the label is not the repository owner. (Other labels do not start this job at all.)
- `notify failed: HTTP 400`: Telegram refused the chat. The usual cause is that the bot was not started in the chat (press Start in the bot), or the chat id is wrong. This was the cause at the first setup on 2026-11-19.
- `notify failed: <error name>`: the request did not reach Telegram. Run again later. Not checked further.
- `notify sent`: Telegram accepted the message. If it is still not in the chat, check the chat and the bot. Not checked further.

The label check: it is not known yet whether a label that an agent adds comes from the owner's account. The first `try-preview` message will show it. If the log says "sends nothing" for an agent's label, that is the reason.

## Ideas for later (not in the code)

- Link preview options. The code asks for link previews (`disable_web_page_preview` is false). The newer `link_preview_options` setting is not used. Not checked.
- A passed count ("N/N passed") in the production message.
- A line in the try-preview message that says what to try.
