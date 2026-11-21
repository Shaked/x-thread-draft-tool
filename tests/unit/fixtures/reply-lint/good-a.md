## TL;DR
Six questions on the [#273 one product epic](https://github.com/Shaked/x-thread-draft-tool/issues/273) have no answer from you yet. Each has a default.
You need to do 3 things (below).

## What you need to do
1. Answer the margin question on [the margin question comment](https://github.com/Shaked/x-thread-draft-tool/issues/273#issuecomment-7054238173):
   reply `report only`, `re-record once` or `keep as is`.
2. Answer [Q1 to Q4 metrics plan questions](https://github.com/Shaked/x-thread-draft-tool/issues/273#issuecomment-7054844861) in one comment there.
   To keep all defaults, reply `Q1 stay free, Q2 schedule on, Q3 analytics off, Q4 no key`.
3. Say if the decision at 00:53 UTC is yours, on [the 00:53 UTC decision comment](https://github.com/Shaked/x-thread-draft-tool/issues/273#issuecomment-7054573055):
   reply `yes, mine` or `not mine`.

## Waiting for
Nothing.

## Blocked on you
### Margin rule for the tool text test
- **What is decided:** whether [#279 tool text wording](https://github.com/Shaked/x-thread-draft-tool/issues/279) can ship text
  that makes Claude, ChatGPT and Grok pick our tools more often. A test rule stops it today: no "margin" may go down.
  A margin is how far the right tool scores above the next best one.
- **Options:**
  1. **Report only** (reply `report only`): margins show in the test output but no longer fail it. The top-1, top-3,
     admin-leak and known-failure checks stay. Each PR lists the margins that fell, and Opus checks the list.
  2. **Re-record once** (reply `re-record once`): margins still fail the test. The #279 PR records new margins once,
     with your approval. Every later text change needs your approval again.
  3. **Keep as is** (reply `keep as is`): nothing changes. #279 cannot change the tool text, and the 3 admin leaks
     and 27 misses per mode stay (numbers from the question, not checked again).
- **Recommendation:** report only (Opus, 2026-11-21). Margins are raw search scores that change scale whenever any
  tool text changes, so two versions cannot be compared.
- **If nobody answers:** keep as is. #279 and [#280 slash command prompts](https://github.com/Shaked/x-thread-draft-tool/issues/280) wait.
- **Where to answer:** [the margin question comment](https://github.com/Shaked/x-thread-draft-tool/issues/273#issuecomment-7054238173), with the words above.

### Four questions from the metrics plan
They come from the plan of [#331 metrics and observability plan](https://github.com/Shaked/x-thread-draft-tool/issues/331).
Its seven build tasks carry the label `held` until you talk about the plan. Answer all four in one comment on
[the metrics questions comment](https://github.com/Shaked/x-thread-draft-tool/issues/273#issuecomment-7054844861).
If nobody answers, each default applies (from when: the plan does not say).

| Question | What is decided | Options (reply words): what happens | Recommendation and default |
|---|---|---|---|
| Q1 (pay Vercel for metrics), money | Do you pay so Vercel shows its own speed numbers? | **Stay free** (`Q1 stay free`): $0; the app records its own p50 to p99.9 per route and tool. **Pay Vercel** (`Q1 pay Vercel`): Vercel Pro plus Observability Plus, Vercel's percentiles and longer logs; price not checked. | Stay free: $0, and per-tool numbers need the app's own records anyway. Default: stay free. |
| Q2 (run metrics on schedule), product behaviour | Do you get alerts on Telegram? | **Schedule on** (`Q2 schedule on`): a workflow runs every 6 hours, stores yesterday's numbers and checks 3 alerts (errors, slow, capacity). **Manual only** (`Q2 manual only`): no alerts; a day without a run has no active-user number. | Schedule on, because #331 asks for alerts. Default: schedule on. |
| Q3 (turn on Web Analytics), money and privacy | Do you see page views per page and country? Today Vercel Web Analytics is off. | **Analytics off** (`Q3 analytics off`): no browser numbers. **Analytics on** (`Q3 analytics on`): page views per page and country; a script on every page; free limits not checked. | Analytics off for now: it adds a script to every page. Default: off. |
| Q4 (Neon key for hours), secret | Does the admin page show the database hours used? | **No key** (`Q4 no key`): hours are read by hand (about 9 of the free 100 this month, read by the planner on 2026-11-21, not checked by me). **Add key** (`Q4 add key`): one more secret in Vercel; the admin page shows the hours. | No key: one secret fewer. Default: no key. |

### Was the decision at 00:53 UTC yours?
- **What is decided:** whether this rule counts as your decision: a margin floor may drop by at most 0.01, only when
  no top-1, top-3 or known-failure check gets worse. [The 00:53 UTC decision comment](https://github.com/Shaked/x-thread-draft-tool/issues/273#issuecomment-7054573055)
  records it in your name. Agents also post from your GitHub account, so the comment alone does not show who wrote it.
  It follows [the `Yes` reply on #279](https://github.com/Shaked/x-thread-draft-tool/issues/279#issuecomment-7053999559) at 00:20 UTC,
  which has no Claude Code footer (checked). This rule is separate from the margin question above.
- **Options:**
  1. **Yes, mine** (reply `yes, mine`): the 0.01 rule stays and goes into `docs/architecture/mcp-discovery.md`. Alone it does
     not let #279 pass: the current wording drops some margins by far more (from the comment, not checked again).
  2. **Not mine** (reply `not mine`): the record on the epic is corrected, and margin floors stay as strict as today.
- **Recommendation:** none. Only you know who wrote it.
- **If nobody answers:** no default was set (checked: no comment names one). The record stays as written.
- **Where to answer:** the 00:53 UTC decision comment linked above, with the words above.

## Done
- Read every comment on #273 and #279 on 2026-11-21: none answers these six questions, checked.
