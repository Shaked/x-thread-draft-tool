## TL;DR
Board of 2026-11-26 12:00 UTC: 12 open tickets, 3 in progress, 4 need you, 1 stuck, 1 done since the last board (checked).
You need to do 4 things (below).

## What you need to do
1. [#301 autosave timing issue](https://github.com/example/repo/issues/301): `should drafts save on every keystroke`. Reply `save-each` [there](https://github.com/example/repo/issues/301#issuecomment-1).
2. [#302 turn on admin tools by](https://github.com/example/repo/issues/302): `labelled 'owner': read the issue for the step`. Answer [there](https://github.com/example/repo/issues/302).
3. [#303 share link sign-in](https://github.com/example/repo/issues/303): `Create the GitHub OAuth app for preview sign-in`. Reply `oauth-done` [there](https://github.com/example/repo/issues/303#issuecomment-2).
4. [#304 draft search ranking](https://github.com/example/repo/issues/304): `decide the search ranking: newest first or best match`. Answer [there](https://claude.ai/code/session_asks).

## Waiting for
- [#306 undo stack issue](https://github.com/example/repo/issues/306), [session](https://claude.ai/code/session_failed) `failed`: waits for the dispatcher. Expected: not known.
- [#307 word count issue](https://github.com/example/repo/issues/307): the session works on it. Expected: not known.
- [#308 theme switch issue](https://github.com/example/repo/issues/308), [#408 Theme switch issue](https://github.com/example/repo/pull/408) open, checks `red`, 1 open Codex thread: waits for CI or review. Expected: not known.
- [#309 tag filter issue](https://github.com/example/repo/issues/309), [session](https://claude.ai/code/session_review) `review ready`: waits for CI or review. Expected: not known.

## Blocked on you
- [#301](https://github.com/example/repo/issues/301): an open owner question ([link](https://github.com/example/repo/issues/301#issuecomment-1)).
- [#302](https://github.com/example/repo/issues/302): label `owner` ([link](https://github.com/example/repo/issues/302)).
- [#303](https://github.com/example/repo/issues/303): the last HANDOFF names a step for you ([link](https://github.com/example/repo/issues/303#issuecomment-2)).
- [#304](https://github.com/example/repo/issues/304): a session asks for a decision ([link](https://claude.ai/code/session_asks)).

## Done
- [#412 Export button issue](https://github.com/example/repo/pull/412) merged 2026-11-26 10:00 UTC for [#312 export button issue](https://github.com/example/repo/issues/312), checked.

## Details
### Needs you
| Ticket | PR | Session | Owner needed? | Next step | Who |
|---|---|---|---|---|---|
| [#301](https://github.com/example/repo/issues/301) | none | none | yes: `should drafts save on every keystroke`, reply `save-each` | Reply `save-each` | Shaked |
| [#302](https://github.com/example/repo/issues/302) | none | none | yes: `labelled 'owner': read the issue for the step` | Answer on the issue | Shaked |
| [#303](https://github.com/example/repo/issues/303) | none | none | yes: `Create the GitHub OAuth app for preview sign-in`, reply `oauth-done` | Reply `oauth-done` | Shaked |
| [#304](https://github.com/example/repo/issues/304) | none | [session](https://claude.ai/code/session_asks) `blocked` | yes: `decide the search ranking: newest first or best match` | Answer the session | Shaked |

### Stuck: failed, waits for an answer, or a dispatcher step
| Ticket | PR | Session | Owner needed? | Next step | Who |
|---|---|---|---|---|---|
| [#306](https://github.com/example/repo/issues/306) | none | [session](https://claude.ai/code/session_failed) `failed` | no | Resume: send "continue from your last step" once; failed twice, a new session with Sonnet on the same branch. | dispatcher |

### Running
| Ticket | PR | Session | Owner needed? | Next step | Who |
|---|---|---|---|---|---|
| [#307](https://github.com/example/repo/issues/307) | none | [session](https://claude.ai/code/session_works) `running` | no | Works on it | the session |

### Waiting for CI or review
| Ticket | PR | Session | Owner needed? | Next step | Who |
|---|---|---|---|---|---|
| [#308](https://github.com/example/repo/issues/308) | [#408](https://github.com/example/repo/pull/408) open, checks `red`, 1 open Codex thread | none | no | Fix the red checks | the session |
| [#309](https://github.com/example/repo/issues/309) | [#409 Tag filter issue](https://github.com/example/repo/pull/409) open, checks `green`, 0 open Codex threads | [session](https://claude.ai/code/session_review) `review ready` | no | Opus judges the final head, then merge | Opus |

### Held
| Ticket | PR | Session | Owner needed? | Next step | Who |
|---|---|---|---|---|---|
| [#310 word count export](https://github.com/example/repo/issues/310) | none | none | no | Starts after [#307](https://github.com/example/repo/issues/307) | dispatcher |
| [#311 create the OAuth app by](https://github.com/example/repo/issues/311) | none | none | no | Parked: waits until you pick it up | Shaked |

### Done since the last board
| Ticket | PR | Session | Owner needed? | Next step | Who |
|---|---|---|---|---|---|
| [#312](https://github.com/example/repo/issues/312) | [#412](https://github.com/example/repo/pull/412) merged | [session](https://claude.ai/code/session_done) `completed` | no | None | nobody |

### Epics and trackers
- [#300 Epic editor work](https://github.com/example/repo/issues/300) (epic): 3 of 14 sub-issues closed.
- [#430 Manual tests for the owner](https://github.com/example/repo/issues/430) (tracker): 1 manual test with no answer, optional, nothing waits.

### Manual tests (optional, nothing waits)
- `Phone: bottom bar spacing` ([test](https://github.com/example/repo/issues/430)): no answer yet.

### What was read
- Sessions: 7 read on 1 page (`list_sessions mine=true limit=100`) at 2026-11-26 12:00 UTC, 6 in scope, checked.
- GitHub: 14 open issues, 2 open PRs, checked. 2 open tickets have no session, PR or owner step: not listed.
