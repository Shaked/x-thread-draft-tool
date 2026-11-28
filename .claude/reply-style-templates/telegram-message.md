# Telegram message templates

Eight kinds, one shape. `scripts/notify-telegram.mjs` sends these forms. The owner reads English, so the messages are
English only. The owner decided on 2026-11-25 (issue #463): every headline starts with its emoji, and a section with
nothing to say is left out. The owner decided on 2026-11-26 (issue #504): the channel is shared with other apps, so
every message names its app.

## The shape
1. One emoji, then the app name in bold, then ` · ` and the headline, linked to the main page for this message. The headline says what happened, in plain words. The app name comes from one place (`DEFAULT_APP` in `scripts/notify-telegram.mjs`, or `TELEGRAM_APP_NAME`), never from a template.
2. The item: the short commit id and the commit title, or the PR or issue title.
3. One fact, only when the kind has one.
4. `Needs you:` and one action. Leave the line out when nothing is needed.
5. Other links, separated by ` · `. Leave the line out when there is no other link.

Rules:
- At most 5 lines. One emoji, at the start of line 1: ✅ production live, 🚨 production failed, 👀 try on preview, 🙋 needs you, 🧹 cleanup, 🐢 speed. Bold is only for the app name.
- Never write "Nothing needed", "None" or an empty section.
- The same words every time: production, preview, PR, issue, smoke test, run, deploy.
- A title is cut to 120 characters, then escaped. A link that is not `https://` becomes plain text.
- Every message names its app on line 1. `<app name>` below is that name, for example `Thread Draft`. `npm run reply-lint -- --kind=telegram` fails a message whose line 1 has no bold name followed by ` · `; add `--app=<name>` to require that exact name.
- Never a secret, a login name, draft text, a PR body (except its `Summary:` line) or log output.
- `<...>` marks a value. `[only when ...]` marks a line the script leaves out when it has no value.

## 1. Production
Sent by the smoke test after a production deploy. Two forms.

Passed:
```text
✅ **<app name>** · [Production is live and tested](<production url>)
`<sha7>` <commit title>
[Open production](<production url>) · [Commit <sha7>](<commit url>) · [See the run](<run url>)   [run link only when the workflow passes it]
```

A photo (issue #628): when the deployed commit added a changelog entry with a screenshot, the same text is the caption of the changelog image (cut to 1024 characters). Otherwise the message is text only.

Example:
```text
✅ **Thread Draft** · [Production is live and tested](https://x-thread-draft-tool.vercel.app)
`46070af` Thread view: one action row and purple accent
[Open production](https://x-thread-draft-tool.vercel.app) · [Commit 46070af](https://github.com/Shaked/x-thread-draft-tool/commit/46070af1234567890abcdef1234567890abcdef1) · [See the run](https://github.com/Shaked/x-thread-draft-tool/actions/runs/1)
```

Failed or skipped:
```text
🚨 **<app name>** · [Production smoke test failed](<run url>)
`<sha7>` <commit title>
Production runs this commit, and its smoke test failed or did not run.
Needs you: open the run and read the first failed step.
[Open production](<production url>)
```

Example:
```text
🚨 **Thread Draft** · [Production smoke test failed](https://github.com/Shaked/x-thread-draft-tool/actions/runs/1)
`46070af` Thread view: one action row and purple accent
Production runs this commit, and its smoke test failed or did not run.
Needs you: open the run and read the first failed step.
[Open production](https://x-thread-draft-tool.vercel.app)
```

## 2. Try it on preview
Sent when the owner's account adds the label `try-preview` to a PR.

```text
👀 **<app name>** · [Try it on preview](<preview url>)
<PR title>
What changed: <the PR's Summary line>   [only when the first line of the PR body starts with "Summary:"]
Needs you: try the change on preview.
[PR #<n> on GitHub](<PR url>)
```

Example:
```text
👀 **Thread Draft** · [Try it on preview](https://x-thread-draft-tool-preview.vercel.app)
Thread view: one action row and purple accent
What changed: the thread view shows its three buttons in one row.
Needs you: try the change on preview.
[PR #424 on GitHub](https://github.com/Shaked/x-thread-draft-tool/pull/424)
```

## 3. Needs you
Sent when the owner's account adds the label `owner` to an issue or a PR.

```text
🙋 **<app name>** · [A PR needs you](<PR url>)   [or "An issue needs you", from whether the label is on a PR]
<issue or PR title>
Needs you: open it and answer or do what it asks.
```

Example:
```text
🙋 **Thread Draft** · [An issue needs you](https://github.com/Shaked/x-thread-draft-tool/issues/369)
Changelog entries and Telegram messages follow the writing templates
Needs you: open it and answer or do what it asks.
```

## 4. Cleanup review
Two forms. The PR form is sent when the owner's account adds the label `cleanup-pr` to a PR. The started form
is sent when the cleanup workflow opens its issue.

PR ready:
```text
🧹 **<app name>** · [Cleanup review ready](<PR url>)
<PR title>
What it removes: <the PR's Summary line>   [only when the first line of the PR body starts with "Summary:"]
Needs you: review the PR, then merge or close it. Agents never merge a cleanup PR.
```

Example:
```text
🧹 **Thread Draft** · [Cleanup review ready](https://github.com/Shaked/x-thread-draft-tool/pull/12)
Remove duplicate tests
What it removes: two parser tests that check the same thing.
Needs you: review the PR, then merge or close it. Agents never merge a cleanup PR.
```

Started:
```text
🧹 **<app name>** · [Cleanup review started](<issue url>)
<issue title>
An agent reviews the commits since the last review and opens up to three PRs.
```

Example:
```text
🧹 **Thread Draft** · [Cleanup review started](https://github.com/Shaked/x-thread-draft-tool/issues/34)
Cleanup review 2026-11-25
An agent reviews the commits since the last review and opens up to three PRs.
```

## 5. Metrics alert
Sent by the `alerts` job of `metrics-daily.yml` (task O7 of the observability plan, #338) as the kind `metrics`, in the Alert
shape of section 6: one message per alert that is new (errors, slow or capacity), and again only after 24 hours clear. The headline links to the metrics page.
The number line gives the value in plain words, the window, the limit, how much over, the usual value and since when (UTC). The
likely cause line is always there. The last line says what happens next: `Needs you:` for the capacity alert, and for errors and
slow `Next: no new message for this alert until it has been clear for 24 hours.` Order: headline, number line, likely cause line, last line.

```text
🚨 **<app name>** · [Metrics alert: <the alert that fired, in words>](<production url>/admin/metrics)
<Alert>: <the value, in plain words>, in the last <window>. The limit is <limit> (<n> % over), usual <usual>, since <UTC date and time>.
Likely cause: <one cause and its evidence>.   [or: "Likely cause: not known yet."]
Needs you: <the plan limit that is near, and the step to take>.   [capacity alert; errors and slow say "Next: no new message ... clear for 24 hours."]
```

Example:
```text
🚨 **Thread Draft** · [Metrics alert: slow answers](https://x-thread-draft-tool.vercel.app/admin/metrics)
Slow: the slowest 5 % of 4200 API requests took 1380 ms or more in 24 hours. The limit is 1000 ms (38 % over), usual 90 ms, since 2026-11-26 09:17 UTC.
Likely cause: GET /drafts used the most request time (3100 s).
Next: no new message for this alert until it has been clear for 24 hours.
```

## 6. Alert shape (kinds `speed` and `metrics`)
Sent by the speed check (`scripts/speed-metrics.mjs`, task M7 of plan #439) as kind `speed`. The per-merge run sends it once when a
streak of production merges over a limit starts, and again only after the stages have been within their limits for
24 hours. The headline links to the gate issue, or to the run. Four lines at most: the headline, the number, the likely
cause, and at most two links. The one other line says what happens next: `Needs you:` when the owner must act, and for the `metrics` errors and slow alerts `Next: ...`. `speed` never has one,
so its message has no action line. The `metrics` kind (section 5) uses this same shape; its capacity alert adds `Needs you:`,
which makes five lines.

```text
🐢 **<app name>** · [<what is over, in plain words>](<gate issue, or run, url>)
This merge took <time> in <stage>. The limit is <limit> (<n> % over), since <UTC date and time> (<n> in a row).
Likely cause: <one cause and its evidence>.   [or: "Likely cause: not known yet."]
Needs you: <the one action>.   [only when the owner must act: the metrics capacity alert; the speed kind never has this line]
[<Speed table>](<run url>) · [What the stages mean](<docs url>)
```

Rules:
- Stage names in plain words: CI checks, merge wait, deploy, smoke test, the total.
- Times as "3 min 38 s" or "47 s". Percentages as "45 %". Times in UTC.
- A manual run says "1 in 10 merges took <time> or more in <stage>" (its p90) instead of "This merge took".

Example:
```text
🐢 **Thread Draft** · [Delivery is slower than its limit: CI checks and the total](https://github.com/owner/repo/issues/9)
This merge took 2 min 49 s in CI checks. The limit is 1 min 30 s (88 % over), since 2026-11-24 14:10 UTC (7 in a row).
Likely cause: Fonts took 1 min 10 s against a usual 40 s.
[Speed table](https://github.com/owner/repo/actions/runs/42) · [What the stages mean](https://github.com/owner/repo/blob/main/docs/plans/speed.md#1-definitions)
```
