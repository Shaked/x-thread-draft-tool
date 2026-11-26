## TL;DR
Board of <YYYY-MM-DD HH:MM> UTC: <n> open tickets, <n> in progress, <n> need you, <n> stuck, <n> done since the last board (checked).
<"Nothing needed from you." or "You need to do N things (below).">

## What you need to do
Nothing.

<Or one numbered step per "Needs you" row, with a link and the exact words to type:>
1. [<#n, 3 to 6 words>](<link>): `<what is asked>`. Reply `<exact words>` [there](<comment link>).

## Waiting for
- [<#n, 3 to 6 words>](<link>) · [session](https://claude.ai/code/session_<id>) `<state>`: <the session works on it, waits for CI or review, or waits for the dispatcher>. Expected: not known.

<Or "Nothing.">

## Blocked on you
- [<#n>](<link>): <which owner rule: an open owner question, label `owner`, the last HANDOFF names a step for you,
  or a session asks for a decision> ([link](<comment or session link>)).

<Or "Nothing.">

## Done
- [<#pr, 3 to 6 words>](<link>) merged <YYYY-MM-DD HH:MM> UTC for [<#n, 3 to 6 words>](<link>), checked.

<Or "- No pull request merged since the last board, checked.">

## Details
### Needs you
| Ticket | PR | Session | Owner needed? | Next step | Who |
|---|---|---|---|---|---|
| [<#n>](<link>) | [<#pr>](<link>) <open, checks `green` or `red`, N open Codex threads, or merged> | [session](<link>) `<running, review ready, blocked, failed or completed>` | <`no`, or yes: `<what>`, reply `<exact words>`> | <next step> | <Shaked, the session, dispatcher, CI, Opus or nobody> |

<Or "None."> Then the same table, or "None.", under each group in this order:
### Stuck: failed, waits for an answer, or a dispatcher step
### Running
### Waiting for CI or review
### Held
### Done since the last board

### Epics and trackers
- [<#n, 3 to 6 words>](<link>) (epic): <closed> of <total> sub-issues closed.

### Manual tests (optional, nothing waits)
- [<test title>](<link>): no answer yet.

### What was read
- Sessions: <n> read on <n> pages (`<list_sessions call>`) at <time> UTC, <n> in scope, checked.
- GitHub: <n> open issues, <n> open PRs, checked. <n> open tickets have no session, PR or owner step: not listed.
