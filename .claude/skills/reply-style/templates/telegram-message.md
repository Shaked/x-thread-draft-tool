# Telegram message templates

Five kinds, one shape. `scripts/notify-telegram.mjs` still sends the old text until the Telegram code
step of task #369 moves it to this one. The owner reads English, so the messages are English only.

## The shape
1. The headline in bold, linked to the main page for this message. It says what happened, in plain words.
2. The item: the short commit id and the commit title, or the PR or issue title.
3. One fact, only when the kind has one.
4. `Needs you:` and one action, or `Nothing needed.`
5. Other links, separated by ` · `. Leave the line out when there is no other link.

Rules:
- At most 5 lines. No emoji. Bold is only for the headline.
- The same words every time: production, preview, PR, issue, smoke test, run, deploy.
- A title is cut to 120 characters, then escaped. A link that is not `https://` becomes plain text.
- Never a secret, a login name, draft text, a PR body (except its `Summary:` line) or log output.
- `<...>` marks a value. `[only when ...]` marks a line the script leaves out when it has no value.

## 1. Production
Sent by the smoke test after a production deploy. Two forms.

Passed:
```text
**[Production is live and tested](<production url>)**
`<sha7>` <commit title>
Nothing needed.
[See the run](<run url>)   [only when the workflow passes the run link]
```

Example:
```text
**[Production is live and tested](https://x-thread-draft-tool.vercel.app)**
`46070af` Thread view: one action row and purple accent
Nothing needed.
[See the run](https://github.com/Shaked/x-thread-draft-tool/actions/runs/1)
```

Failed or skipped:
```text
**[Production smoke test failed](<run url>)**
`<sha7>` <commit title>
Production runs this commit, and its smoke test failed or did not run.
Needs you: open the run and read the first failed step.
[Open production](<production url>)
```

Example:
```text
**[Production smoke test failed](https://github.com/Shaked/x-thread-draft-tool/actions/runs/1)**
`46070af` Thread view: one action row and purple accent
Production runs this commit, and its smoke test failed or did not run.
Needs you: open the run and read the first failed step.
[Open production](https://x-thread-draft-tool.vercel.app)
```

## 2. Try it on preview
Sent when the owner's account adds the label `try-preview` to a PR.

```text
**[Try it on preview](<preview url>)**
<PR title>
What changed: <the PR's Summary line>   [only when the first line of the PR body starts with "Summary:"]
Needs you: try the change on preview.
[PR #<n> on GitHub](<PR url>)
```

Example:
```text
**[Try it on preview](https://x-thread-draft-tool-preview.vercel.app)**
Thread view: one action row and purple accent
What changed: the thread view shows its three buttons in one row.
Needs you: try the change on preview.
[PR #424 on GitHub](https://github.com/Shaked/x-thread-draft-tool/pull/424)
```

## 3. Needs you
Sent when the owner's account adds the label `owner` to an issue or a PR.

```text
**[A PR needs you](<PR url>)**   [or "An issue needs you", from whether the label is on a PR]
<issue or PR title>
Needs you: open it and answer or do what it asks.
```

Example:
```text
**[An issue needs you](https://github.com/Shaked/x-thread-draft-tool/issues/369)**
Changelog entries and Telegram messages follow the writing templates
Needs you: open it and answer or do what it asks.
```

## 4. Cleanup review
Two forms. The PR form is sent when the owner's account adds the label `cleanup-pr` to a PR. The started form
is sent when the cleanup workflow opens its issue.

PR ready:
```text
**[Cleanup review ready](<PR url>)**
<PR title>
What it removes: <the PR's Summary line>   [only when the first line of the PR body starts with "Summary:"]
Needs you: review the PR, then merge or close it. Agents never merge a cleanup PR.
```

Example:
```text
**[Cleanup review ready](https://github.com/Shaked/x-thread-draft-tool/pull/12)**
Remove duplicate tests
What it removes: two parser tests that check the same thing.
Needs you: review the PR, then merge or close it. Agents never merge a cleanup PR.
```

Started:
```text
**[Cleanup review started](<issue url>)**
<issue title>
Nothing needed. An agent reviews the commits since the last review and opens up to three PRs.
```

Example:
```text
**[Cleanup review started](https://github.com/Shaked/x-thread-draft-tool/issues/34)**
Cleanup review 2026-11-25
Nothing needed. An agent reviews the commits since the last review and opens up to three PRs.
```

## 5. Metrics alert
No workflow sends this kind yet. Task O7 of the observability plan adds it as the kind `metrics`, with three alerts:
errors, slow and capacity (`docs/plans/observability.md`, section 6). One line per alert that fired, at most three.

```text
**[Metrics alert: <the alerts that fired, in words>](<production url>/admin/metrics)**
<Alert>: <the value, in plain words>, in the last <window>. The limit is <limit>.   [one line per alert]
Needs you: open the metrics page and find the route with the errors or the slow answers.
```

Example:
```text
**[Metrics alert: slow answers](https://x-thread-draft-tool.vercel.app/admin/metrics)**
Slow: the slowest 5 % of API requests took 1380 ms or more in the last 24 hours. The limit is 1000 ms.
Needs you: open the metrics page and find the route with the errors or the slow answers.
```
